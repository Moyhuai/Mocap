// 视觉动作捕捉系统 - 类型定义
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

/** 10 种动作类型（6 种全身 + 4 种腿部） */
export type ActionType = 'handRaise' | 'squat' | 'jump' | 'bow' | 'wave' | 'turn' | 'kick' | 'step' | 'sideStep' | 'legRaise'

/** 4 类提示类型 */
export type PromptType = 'encourage' | 'correct' | 'warn' | 'complete'

/** 单个动作在某帧的状态 */
export interface ActionState {
  active: boolean
  confidence: number
  meta?: Record<string, number>
}

/** 提示载荷 */
export interface PromptPayload {
  type: PromptType
  message: string
  action?: ActionType
  timestamp?: number
  personIndex?: number
}

/** 提示模板,用于从配置生成文案 */
export interface PromptTemplate {
  type: PromptType
  action?: ActionType
  messages: string[]
}

/** 滚动历史帧窗口 */
export interface FrameHistory {
  frames: PoseFrameResult[]
  maxLen: number
}

/** 单人的骨架数据 */
export interface PersonLandmarks {
  landmarks: NormalizedLandmark[]
  worldLandmarks?: NormalizedLandmark[]
  /** 面部 478 关键点 (FaceLandmarker) */
  faceLandmarks?: NormalizedLandmark[]
  /** 手部关键点数组 (HandLandmarker, 最多 2 只手) */
  handLandmarks?: NormalizedLandmark[][]
}

/** 手势类型 */
export type GestureType = 'fist' | 'open' | 'ok' | 'peace' | 'thumbsUp' | 'pointing' | null

/** 手势检测结果 */
export interface GestureResult {
  gesture: GestureType
  confidence: number
  handIndex: number
}

/** 物品检测结果 */
export interface ObjectDetection {
  class: string
  score: number
  bbox: [number, number, number, number] // [x, y, width, height] 归一化坐标
}

/** MediaPipe 单帧检测结果(支持多人) */
export interface PoseFrameResult {
  persons: PersonLandmarks[]
  timestampMs: number
  fps: number
  objects?: ObjectDetection[]
}

/** PoseCapture 构造参数 */
export interface PoseCaptureOptions {
  width?: number
  height?: number
  mirror?: boolean
  numPoses?: number
}

/** Visualizer 构造参数 */
export interface VisualizerOptions {
  lineWidth?: number
  pointRadius?: number
  accentColor?: string
}

/** 骨架样式 */
export interface SkeletonStyle {
  lineColor: string
  pointColor: string
  highlightColor: string
}

/** 渲染附加信息 */
export interface RenderExtra {
  detections?: PersonDetection[]
}

/** 单人的动作检测结果 */
export interface PersonDetection {
  index: number
  current: ActionType | null
  confidence: number
  state: Record<ActionType, ActionState>
  visibleCount: number
}

/** 动作规则定义 */
export interface ActionRule {
  id: ActionType
  name: string
  /** 动作判定函数,返回该动作的状态 */
  evaluate: (lm: NormalizedLandmark[], history: FrameHistory) => ActionState
  /** 该动作的纠正提示触发条件(可选) */
  correct?: (lm: NormalizedLandmark[], state: ActionState) => string | null
}

/** ActionDetector 单帧检测结果(支持多人) */
export interface MultiDetectionResult {
  persons: PersonDetection[]
  prompts: PromptPayload[]
  totalVisibleCount: number
}

/** Pinia store 中的提示条目 */
export interface PromptEntry extends PromptPayload {
  id: number
  timestamp: number
}

/** 系统运行状态 */
export type RunStatus = 'idle' | 'loading' | 'running' | 'error'

/** 灵敏度等级 */
export type Sensitivity = 'low' | 'medium' | 'high'

/** 录制片段载荷(向后端发送) */
export interface RecordingPayload {
  action: string
  timestamp: number
  durationMs: number
  confidence: number
  personIndex?: number
}

/** 录制片段响应 */
export interface RecordingResponse {
  id: string
  savedAt: number
}

/** 系统配置响应(后端下发) */
export interface SystemConfigResponse {
  actions: Array<{ id: ActionType; name: string }>
  promptTemplates: PromptTemplate[]
  defaults: {
    sensitivity: Sensitivity
    mirror: boolean
    targetFps: number
  }
}
