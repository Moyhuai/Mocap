// 动作检测器:基于姿态关键点判定 6 种动作 + 4 类提示(支持多人)
// 精度优化: EMA 关键点平滑 + 动作状态机(连续帧确认) + 多帧投票
import { actionRules, promptTemplates, appConfig } from './config'
import type {
  ActionRule,
  ActionType,
  ActionState,
  FrameHistory,
  MultiDetectionResult,
  PersonDetection,
  PoseFrameResult,
  PromptPayload,
  PromptTemplate,
} from '@/types'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const pickMessage = (tpl: PromptTemplate): string => {
  const arr = tpl.messages
  return arr[Math.floor(Math.random() * arr.length)] ?? ''
}

// ============ EMA 关键点平滑滤波器 ============

interface SmoothedLandmark {
  x: number
  y: number
  z: number
  visibility: number
}

/**
 * 对每个人的关键点做自适应 EMA 平滑,消除帧间抖动
 * 根据运动速度和关键点可见度动态调整平滑系数
 */
class LandmarkSmoother {
  private prev: Map<number, SmoothedLandmark[]> = new Map()
  private prevVelocity: Map<number, number[]> = new Map() // 记录每个关键点的历史速度
  private baseAlpha = 0.3 // 基础 EMA 系数
  private fastAlpha = 0.6 // 快速运动时的系数
  private slowAlpha = 0.2 // 慢速运动时的系数
  private motionThreshold = 0.015 // 运动速度阈值

  smooth(personIndex: number, landmarks: NormalizedLandmark[]): NormalizedLandmark[] {
    const prev = this.prev.get(personIndex)
    const prevVel = this.prevVelocity.get(personIndex) || []
    
    if (!prev || prev.length !== landmarks.length) {
      // 首帧直接记录
      this.prev.set(personIndex, landmarks.map(l => ({
        x: l.x, y: l.y, z: l.z ?? 0, visibility: l.visibility ?? 1,
      })))
      this.prevVelocity.set(personIndex, new Array(landmarks.length).fill(0))
      return landmarks
    }

    const smoothed: NormalizedLandmark[] = []
    const newPrev: SmoothedLandmark[] = []
    const newVel: number[] = []
    
    for (let i = 0; i < landmarks.length; i++) {
      const cur = landmarks[i]
      const p = prev[i]
      const oldVel = prevVel[i] || 0
      
      if (!cur || !p) {
        smoothed.push(cur ?? p as unknown as NormalizedLandmark)
        newPrev.push(cur ? { x: cur.x, y: cur.y, z: cur.z ?? 0, visibility: cur.visibility ?? 1 } : p)
        newVel.push(0)
        continue
      }
      
      // 计算当前帧的运动速度
      const velocity = Math.sqrt(
        Math.pow(cur.x - p.x, 2) + 
        Math.pow(cur.y - p.y, 2) + 
        Math.pow((cur.z ?? 0) - (p.z ?? 0), 2)
      )
      
      // 速度平滑（避免速度本身抖动）
      const smoothedVel = oldVel * 0.7 + velocity * 0.3
      
      // 根据可见度和速度自适应调整 alpha
      const vis = cur.visibility ?? 1
      let alpha: number
      
      if (vis < 0.6) {
        // 低可见度：更信任当前帧
        alpha = 0.7
      } else if (smoothedVel > this.motionThreshold) {
        // 快速运动：提高响应速度
        const motionRatio = Math.min(1, (smoothedVel - this.motionThreshold) / this.motionThreshold)
        alpha = this.baseAlpha + (this.fastAlpha - this.baseAlpha) * motionRatio
      } else {
        // 慢速运动：增强平滑
        const motionRatio = smoothedVel / this.motionThreshold
        alpha = this.slowAlpha + (this.baseAlpha - this.slowAlpha) * motionRatio
      }
      
      const s = {
        x: p.x * (1 - alpha) + cur.x * alpha,
        y: p.y * (1 - alpha) + cur.y * alpha,
        z: p.z * (1 - alpha) + (cur.z ?? 0) * alpha,
        visibility: p.visibility * (1 - alpha) + vis * alpha,
      }
      smoothed.push({ x: s.x, y: s.y, z: s.z, visibility: s.visibility } as NormalizedLandmark)
      newPrev.push(s)
      newVel.push(smoothedVel)
    }
    
    this.prev.set(personIndex, newPrev)
    this.prevVelocity.set(personIndex, newVel)
    return smoothed
  }

  reset(personIndex?: number): void {
    if (personIndex !== undefined) {
      this.prev.delete(personIndex)
      this.prevVelocity.delete(personIndex)
    } else {
      this.prev.clear()
      this.prevVelocity.clear()
    }
  }
}

// ============ 动作状态机 ============

/** 连续 N 帧确认后才切换动作,避免单帧闪烁 */
const CONFIRM_FRAMES = 3
/** 动作离开后保持 N 帧,避免短暂丢失导致中断 */
const HOLD_FRAMES = 4
/** 置信度加权阈值：低于此值的投票权重降低 */
const CONFIDENCE_WEIGHT_THRESHOLD = 0.5

interface ActionStateMachineState {
  /** 当前已确认的动作 */
  confirmed: ActionType | null
  /** 候选动作及其连续出现次数 */
  candidate: ActionType | null
  candidateCount: number
  /** 已确认动作连续消失的帧数 */
  holdCount: number
  /** 各动作在最近 N 帧的加权投票计数 */
  votes: Record<string, number>
  /** 各动作的原始置信度历史（用于加权） */
  confidenceHistory: Record<string, number[]>
}

class ActionStateMachine {
  private states: Map<number, ActionStateMachineState> = new Map()
  private voteWindow = 6 // 增大投票窗口提升稳定性

  private getState(personIndex: number): ActionStateMachineState {
    let s = this.states.get(personIndex)
    if (!s) {
      s = {
        confirmed: null,
        candidate: null,
        candidateCount: 0,
        holdCount: 0,
        votes: {},
        confidenceHistory: {},
      }
      this.states.set(personIndex, s)
    }
    return s
  }

  /**
   * 输入每帧各动作的检测结果,输出稳定后的动作
   * @param personIndex 人物索引
   * @param rawStates 各动作的原始检测结果
   * @returns 稳定后的当前动作和置信度
   */
  update(
    personIndex: number,
    rawStates: Record<ActionType, ActionState>,
  ): { current: ActionType | null; confidence: number } {
    const s = this.getState(personIndex)

    // 1. 加权投票: 统计最近 N 帧中各动作的加权得分
    // 衰减旧票（按时间衰减）
    for (const key of Object.keys(s.votes)) {
      s.votes[key] = Math.max(0, (s.votes[key] ?? 0) * 0.85) // 指数衰减
    }
    
    // 更新置信度历史
    for (const [action, state] of Object.entries(rawStates)) {
      if (!s.confidenceHistory[action]) {
        s.confidenceHistory[action] = []
      }
      s.confidenceHistory[action].push(state.confidence)
      // 保持窗口大小
      if (s.confidenceHistory[action].length > this.voteWindow) {
        s.confidenceHistory[action].shift()
      }
    }
    
    // 加入当前帧的加权票
    for (const [action, state] of Object.entries(rawStates)) {
      if (state.active && state.confidence > 0.3) {
        // 高置信度动作获得更高权重
        const weight = state.confidence >= CONFIDENCE_WEIGHT_THRESHOLD 
          ? state.confidence * 1.2
          : state.confidence * 0.8
        s.votes[action] = (s.votes[action] ?? 0) + weight
      }
    }

    // 2. 找到加权投票最多的动作
    let bestVote: ActionType | null = null
    let bestVoteScore = 0
    for (const [action, score] of Object.entries(s.votes)) {
      if (score > bestVoteScore) {
        bestVoteScore = score
        bestVote = action as ActionType
      }
    }

    // 3. 状态机: 连续帧确认
    if (bestVote && bestVote !== s.confirmed) {
      if (bestVote === s.candidate) {
        s.candidateCount++
      } else {
        s.candidate = bestVote
        s.candidateCount = 1
      }
      // 达到确认帧数 且 投票得分足够高
      const voteThreshold = this.voteWindow * 0.4
      if (s.candidateCount >= CONFIRM_FRAMES && bestVoteScore >= voteThreshold) {
        s.confirmed = bestVote
        s.holdCount = 0
        s.candidate = null
        s.candidateCount = 0
      }
    } else if (bestVote === s.confirmed) {
      s.holdCount = 0
      s.candidate = null
      s.candidateCount = 0
    }

    // 4. 动作消失保持
    if (!bestVote && s.confirmed) {
      s.holdCount++
      if (s.holdCount > HOLD_FRAMES) {
        s.confirmed = null
        s.holdCount = 0
      }
    }

    // 5. 输出置信度: 取已确认动作的原始置信度与投票率的加权
    if (s.confirmed) {
      const rawState = rawStates[s.confirmed]
      const rawConf = rawState?.confidence ?? 0
      
      // 计算平均置信度（从历史中）
      const confHist = s.confidenceHistory[s.confirmed] || []
      const avgConf = confHist.length > 0 
        ? confHist.reduce((a, b) => a + b, 0) / confHist.length 
        : 0
      
      // 综合置信度：当前原始置信度 + 历史平均 + 投票得分
      const voteRatio = Math.min(1, bestVoteScore / (this.voteWindow * 0.6))
      const finalConf = rawConf * 0.5 + avgConf * 0.3 + voteRatio * 0.2
      
      return {
        current: s.confirmed,
        confidence: Math.min(1, finalConf),
      }
    }

    return { current: null, confidence: 0 }
  }

  reset(personIndex?: number): void {
    if (personIndex !== undefined) {
      this.states.delete(personIndex)
    } else {
      this.states.clear()
    }
  }
}

// ============ 主检测器 ============

export class ActionDetector {
  private rules: ActionRule[]
  private histories: Map<number, FrameHistory> = new Map()
  private completeCounters: Map<number, Record<string, number>> = new Map()
  private lastPromptAt: Record<string, number> = {}
  private smoother: LandmarkSmoother
  private stateMachine: ActionStateMachine

  constructor(rules: ActionRule[] = actionRules) {
    this.rules = rules
    this.smoother = new LandmarkSmoother()
    this.stateMachine = new ActionStateMachine()
  }

  private getHistory(personIndex: number): FrameHistory {
    let h = this.histories.get(personIndex)
    if (!h) {
      h = { frames: [], maxLen: appConfig.historySize }
      this.histories.set(personIndex, h)
    }
    return h
  }

  private getCompleteCounter(personIndex: number): Record<string, number> {
    let c = this.completeCounters.get(personIndex)
    if (!c) {
      c = {}
      this.completeCounters.set(personIndex, c)
    }
    return c
  }

  detect(frame: PoseFrameResult): MultiDetectionResult {
    const persons: PersonDetection[] = []
    const prompts: PromptPayload[] = []
    let totalVisibleCount = 0

    for (let pi = 0; pi < frame.persons.length; pi++) {
      const person = frame.persons[pi]
      const rawLm = person.landmarks

      // EMA 平滑关键点,减少抖动
      const lm = this.smoother.smooth(pi, rawLm)

      // 更新该人的滚动窗口(使用平滑后的数据)
      const history = this.getHistory(pi)
      history.frames.push({
        persons: [{ ...person, landmarks: lm }],
        timestampMs: frame.timestampMs,
        fps: frame.fps,
      })
      if (history.frames.length > history.maxLen) {
        history.frames.shift()
      }

      // 对该人的每个动作规则进行判定
      const state = {} as Record<ActionType, ActionState>
      for (const rule of this.rules) {
        state[rule.id] = rule.evaluate(lm, history)
      }

      // 状态机: 连续帧确认,消除闪烁
      const { current, confidence } = this.stateMachine.update(pi, state)

      const visibleCount = lm.filter((p) => (p?.visibility ?? 1) >= 0.5).length
      totalVisibleCount += visibleCount

      persons.push({
        index: pi,
        current,
        confidence,
        state,
        visibleCount,
      })

      // 为该人生成提示
      const personPrompts = this.maybePrompt(
        pi, current, state, confidence, visibleCount, lm, frame.timestampMs,
      )
      prompts.push(...personPrompts)
    }

    return { persons, prompts, totalVisibleCount }
  }

  /** 根据当前动作与状态生成提示,带去重冷却 */
  private maybePrompt(
    personIndex: number,
    current: ActionType | null,
    state: Record<ActionType, ActionState>,
    confidence: number,
    visibleCount: number,
    lm: NormalizedLandmark[],
    now: number,
  ): PromptPayload[] {
    const results: PromptPayload[] = []

    // 1. 警告:关键点丢失
    if (visibleCount < 12) {
      const p = this.emit('warn', now, undefined, personIndex)
      if (p) results.push(p)
      return results
    }
    if (!current) return results

    // 2. 完成:动作连续达标
    const curState = state[current]
    const counter = this.getCompleteCounter(personIndex)
    const count = (counter[current] ?? 0) + (curState && confidence > 0.5 ? 1 : 0)
    counter[current] = count
    if (count >= appConfig.completeThreshold) {
      counter[current] = 0
      const p = this.emit('complete', now, current, personIndex)
      if (p) results.push(p)
    }

    // 3. 纠正:动作规则提供纠正文案
    const rule = this.rules.find((r) => r.id === current)
    if (rule?.correct && curState) {
      const msg = rule.correct(lm, curState)
      if (msg && Math.random() < 0.06) {
        const p = this.emit('correct', now, current, personIndex, msg)
        if (p) results.push(p)
      }
    }

    // 4. 鼓励:动作置信度高时偶发
    if (confidence > 0.75 && Math.random() < 0.025) {
      const p = this.emit('encourage', now, current, personIndex)
      if (p) results.push(p)
    }

    return results
  }

  private emit(
    type: PromptPayload['type'],
    now: number,
    current: ActionType | undefined,
    personIndex: number,
    overrideMessage?: string,
  ): PromptPayload | undefined {
    const key = `${type}:${current ?? '*'}:p${personIndex}`
    const last = this.lastPromptAt[key] ?? 0
    if (now - last < appConfig.promptCooldownMs) return undefined
    this.lastPromptAt[key] = now

    const tpl = promptTemplates.find(
      (t) => t.type === type && (t.action === current || t.action === undefined),
    )
    const message = overrideMessage ?? (tpl ? pickMessage(tpl) : '')
    if (!message) return undefined
    return {
      type,
      message,
      action: current,
      timestamp: now,
      personIndex,
    }
  }

  reset(): void {
    this.histories.clear()
    this.completeCounters.clear()
    this.lastPromptAt = {}
    this.smoother.reset()
    this.stateMachine.reset()
  }
}
