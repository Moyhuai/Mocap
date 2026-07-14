// 视觉动作捕捉系统 - 配置与动作规则
import type { ActionRule, PromptTemplate } from '@/types'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// ============ 几何工具函数 ============

type Point3D = { x: number; y: number; z: number }

const toPoint = (lm: NormalizedLandmark): Point3D => ({
  x: lm.x,
  y: lm.y,
  z: lm.z ?? 0,
})

const vec = (a: Point3D, b: Point3D): Point3D => ({
  x: b.x - a.x,
  y: b.y - a.y,
  z: b.z - a.z,
})

const dot = (u: Point3D, v: Point3D) => u.x * v.x + u.y * v.y + u.z * v.z

const mag = (u: Point3D) => Math.sqrt(dot(u, u))

/** 计算三点构成的关节角度(度数),顶点为 b */
const jointAngle = (a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark) => {
  const ba = vec(toPoint(b), toPoint(a))
  const bc = vec(toPoint(b), toPoint(c))
  const denom = mag(ba) * mag(bc)
  if (denom < 1e-6) return 180
  const cos = Math.max(-1, Math.min(1, dot(ba, bc) / denom))
  return (Math.acos(cos) * 180) / Math.PI
}

/** 判断关键点是否可见(MediaPipe visibility 字段或置信度) */
const isVisible = (lm?: NormalizedLandmark) => {
  if (!lm) return false
  if (typeof lm.visibility === 'number' && lm.visibility < 0.5) return false
  return true
}

// ============ MediaPipe Pose 33 关键点索引 ============
// 参考: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
const POSE = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const

// ============ 6 种动作规则 ============

export const actionRules: ActionRule[] = [
  {
    id: 'handRaise',
    name: '举手',
    evaluate: (lm) => {
      const ls = lm[POSE.LEFT_SHOULDER]
      const rs = lm[POSE.RIGHT_SHOULDER]
      const le = lm[POSE.LEFT_ELBOW]
      const re = lm[POSE.RIGHT_ELBOW]
      const lw = lm[POSE.LEFT_WRIST]
      const rw = lm[POSE.RIGHT_WRIST]
      if (!isVisible(ls) || !isVisible(rs)) return { active: false, confidence: 0 }
      
      let active = false
      let confidence = 0
      let raisedCount = 0
      
      // 左手检查: 手腕高于肩膀 + 肘部弯曲
      if (isVisible(lw) && isVisible(le)) {
        const handAboveShoulder = lw.y < ls.y - 0.05
        const elbowBent = jointAngle(ls, le, lw) < 160 // 手臂不完全伸直
        if (handAboveShoulder && elbowBent) {
          raisedCount++
          const heightScore = Math.min(1, (ls.y - lw.y) * 3)
          confidence = Math.max(confidence, heightScore * 0.8)
        }
      }
      
      // 右手检查
      if (isVisible(rw) && isVisible(re)) {
        const handAboveShoulder = rw.y < rs.y - 0.05
        const elbowBent = jointAngle(rs, re, rw) < 160
        if (handAboveShoulder && elbowBent) {
          raisedCount++
          const heightScore = Math.min(1, (rs.y - rw.y) * 3)
          confidence = Math.max(confidence, heightScore * 0.8)
        }
      }
      
      // 至少一只手举起
      active = raisedCount > 0
      // 双手举起加分
      if (raisedCount === 2) confidence = Math.min(1, confidence + 0.2)
      
      return { active, confidence: Math.min(1, confidence), meta: { raisedCount } }
    },
    correct: (lm, state) => {
      if (!state.active) return null
      const ls = lm[POSE.LEFT_SHOULDER]
      const rs = lm[POSE.RIGHT_SHOULDER]
      const lw = lm[POSE.LEFT_WRIST]
      const rw = lm[POSE.RIGHT_WRIST]
      if (isVisible(lw) && !isVisible(rw)) return '可同时举起右手保持对称'
      if (isVisible(rw) && !isVisible(lw)) return '可同时举起左手保持对称'
      return null
    },
  },
  {
    id: 'squat',
    name: '深蹲',
    evaluate: (lm, history) => {
      const lh = lm[POSE.LEFT_HIP]
      const rh = lm[POSE.RIGHT_HIP]
      const lk = lm[POSE.LEFT_KNEE]
      const rk = lm[POSE.RIGHT_KNEE]
      const la = lm[POSE.LEFT_ANKLE]
      const ra = lm[POSE.RIGHT_ANKLE]
      const ls = lm[POSE.LEFT_SHOULDER]
      const rs = lm[POSE.RIGHT_SHOULDER]
      
      if (!isVisible(lh) || !isVisible(lk) || !isVisible(la) || !isVisible(ls)) {
        return { active: false, confidence: 0 }
      }
      
      // 多维度验证
      const kneeAngle = jointAngle(lh, lk, la)
      const hipY = (lh.y + rh.y) / 2
      const kneeY = (lk.y + rk.y) / 2
      const shoulderY = (ls.y + rs.y) / 2
      const ankleY = (la.y + ra.y) / 2
      
      // 1. 膝盖弯曲角度 (90-120度为深蹲)
      const kneeScore = kneeAngle < 120 ? (120 - kneeAngle) / 40 : 0
      
      // 2. 臀部低于膝盖 (深蹲特征)
      const hipBelowKnee = hipY > kneeY - 0.02
      
      // 3. 身体重心下降 (肩膀位置降低)
      const shoulderAboveHip = shoulderY < hipY - 0.05
      
      // 4. 膝盖不超过脚尖太多 (防止误判)
      const kneeForward = Math.abs(lk.x - la.x) < 0.15
      
      // 综合判定
      const active = kneeAngle < 115 && hipBelowKnee && shoulderAboveHip
      let confidence = 0
      
      if (active) {
        confidence = kneeScore * 0.5 // 膝盖角度占 50%
        if (hipBelowKnee) confidence += 0.2 // 臀部位置占 20%
        if (shoulderAboveHip) confidence += 0.15 // 重心下降占 15%
        if (kneeForward) confidence += 0.15 // 膝盖位置占 15%
      }
      
      void history
      return { active, confidence: Math.min(1, confidence), meta: { kneeAngle, hipBelowKnee: hipBelowKnee ? 1 : 0 } }
    },
    correct: (lm, _state) => {
      const lk = lm[POSE.LEFT_KNEE]
      const la = lm[POSE.LEFT_ANKLE]
      if (isVisible(lk) && isVisible(la) && Math.abs(lk.x - la.x) > 0.12) {
        return '膝盖应与脚尖同向,避免内扣'
      }
      return '保持背部挺直,臀部向后坐'
    },
  },
  {
    id: 'jump',
    name: '跳跃',
    evaluate: (_lm, history) => {
      const frames = history.frames
      if (frames.length < 6) return { active: false, confidence: 0 }
      const cur = frames[frames.length - 1].persons[0].landmarks
      const prev = frames[frames.length - 6].persons[0].landmarks
      const la = cur[POSE.LEFT_ANKLE]
      const ra = cur[POSE.RIGHT_ANKLE]
      const pla = prev[POSE.LEFT_ANKLE]
      const pra = prev[POSE.RIGHT_ANKLE]
      const lh = cur[POSE.LEFT_HIP]
      const rh = cur[POSE.RIGHT_HIP]
      const plh = prev[POSE.LEFT_HIP]
      const prh = prev[POSE.RIGHT_HIP]
      if (!isVisible(la) || !isVisible(ra) || !isVisible(pla) || !isVisible(pra)) {
        return { active: false, confidence: 0 }
      }
      // 脚踝上抬
      const ankleY = (la.y + ra.y) / 2
      const prevAnkleY = (pla.y + pra.y) / 2
      const ankleLift = prevAnkleY - ankleY
      // 髋部上抬(双重验证)
      let hipLift = 0
      if (isVisible(lh) && isVisible(rh) && isVisible(plh) && isVisible(prh)) {
        const hipY = (lh.y + rh.y) / 2
        const prevHipY = (plh.y + prh.y) / 2
        hipLift = prevHipY - hipY
      }
      // 综合判定: 脚踝和髋部都上抬才算跳跃
      const active = ankleLift > 0.035 && (hipLift > 0.02 || ankleLift > 0.06)
      const liftScore = ankleLift * 6
      const hipBonus = hipLift > 0.02 ? 0.2 : 0
      return { active, confidence: active ? Math.min(1, liftScore * 0.7 + hipBonus) : 0, meta: { ankleLift, hipLift } }
    },
  },
  {
    id: 'bow',
    name: '鞠躬',
    evaluate: (lm) => {
      const ls = lm[POSE.LEFT_SHOULDER]
      const rs = lm[POSE.RIGHT_SHOULDER]
      const lh = lm[POSE.LEFT_HIP]
      const rh = lm[POSE.RIGHT_HIP]
      const nose = lm[POSE.NOSE]
      if (!isVisible(ls) || !isVisible(lh)) return { active: false, confidence: 0 }
      const midShoulder = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: ((ls.z ?? 0) + (rs.z ?? 0)) / 2 }
      const midHip = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: ((lh.z ?? 0) + (rh.z ?? 0)) / 2 }
      const torso = vec(midHip, midShoulder)
      const vertical = { x: 0, y: -1, z: 0 }
      const cos = dot(torso, vertical) / (mag(torso) || 1)
      const angleDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
      // 多维度: 躯干倾斜 + 鼻子低于肩膀
      let noseBelowShoulder = false
      if (isVisible(nose)) {
        noseBelowShoulder = nose.y > midShoulder.y + 0.03
      }
      const active = angleDeg > 40 && (noseBelowShoulder || angleDeg > 55)
      let confidence = 0
      if (active) {
        confidence = Math.min(1, (angleDeg - 25) / 70) * 0.6
        if (noseBelowShoulder) confidence += 0.3
        if (angleDeg > 60) confidence += 0.1
      }
      return { active, confidence: Math.min(1, confidence), meta: { angleDeg, noseBelowShoulder: noseBelowShoulder ? 1 : 0 } }
    },
    correct: () => '鞠躬时双手自然下垂,目视脚前',
  },
  {
    id: 'wave',
    name: '挥手',
    evaluate: (_lm, history) => {
      const frames = history.frames
      if (frames.length < history.maxLen) return { active: false, confidence: 0 }
      // 优先检测右手,备选左手
      let wrists = frames.map((f) => f.persons[0]?.landmarks[POSE.RIGHT_WRIST])
      let elbow = frames.map((f) => f.persons[0]?.landmarks[POSE.RIGHT_ELBOW])
      let shoulder = frames.map((f) => f.persons[0]?.landmarks[POSE.RIGHT_SHOULDER])
      let side = 'right'
      // 如果右手不可见,切换左手
      if (wrists.some((w) => !isVisible(w))) {
        wrists = frames.map((f) => f.persons[0]?.landmarks[POSE.LEFT_WRIST])
        elbow = frames.map((f) => f.persons[0]?.landmarks[POSE.LEFT_ELBOW])
        shoulder = frames.map((f) => f.persons[0]?.landmarks[POSE.LEFT_SHOULDER])
        side = 'left'
      }
      if (wrists.some((w) => !isVisible(w))) return { active: false, confidence: 0 }
      // 验证: 手腕在肩膀以上(挥手特征)
      const rw = wrists[wrists.length - 1]
      const rs = shoulder[shoulder.length - 1]
      const handAboveShoulder = isVisible(rs) && isVisible(rw) && rw.y < rs.y - 0.03
      // 计算 x 坐标方向变化次数
      let crossings = 0
      let lastDir = 0
      let lastX = wrists[0].x
      for (let i = 1; i < wrists.length; i++) {
        const dx = wrists[i].x - lastX
        const dir = dx > 0.004 ? 1 : dx < -0.004 ? -1 : 0
        if (dir !== 0 && dir !== lastDir && lastDir !== 0) crossings++
        if (dir !== 0) lastDir = dir
        lastX = wrists[i].x
      }
      // 验证肘部弯曲(挥手时肘部通常弯曲)
      let elbowBent = false
      if (elbow.every((e) => isVisible(e)) && shoulder.every((s) => isVisible(s))) {
        const lastElbow = elbow[elbow.length - 1]
        const lastShoulder = shoulder[shoulder.length - 1]
        const lastWrist = wrists[wrists.length - 1]
        if (isVisible(lastElbow) && isVisible(lastShoulder) && isVisible(lastWrist)) {
          elbowBent = jointAngle(lastShoulder, lastElbow, lastWrist) < 150
        }
      }
      const active = crossings >= 2 && handAboveShoulder
      let confidence = 0
      if (active) {
        confidence = Math.min(1, crossings / 5) * 0.6
        if (elbowBent) confidence += 0.25
        if (crossings >= 3) confidence += 0.15
      }
      return { active, confidence: Math.min(1, confidence), meta: { crossings, side: side === 'right' ? 1 : 0, handAboveShoulder: handAboveShoulder ? 1 : 0 } }
    },
  },
  {
    id: 'turn',
    name: '转身',
    evaluate: (lm, history) => {
      const ls = lm[POSE.LEFT_SHOULDER]
      const rs = lm[POSE.RIGHT_SHOULDER]
      const lh = lm[POSE.LEFT_HIP]
      const rh = lm[POSE.RIGHT_HIP]
      if (!isVisible(ls) || !isVisible(rs)) return { active: false, confidence: 0 }
      // 肩膀连线与水平线的夹角
      const dx = ls.x - rs.x
      const dy = ls.y - rs.y
      const curAngle = (Math.atan2(dy, dx) * 180) / Math.PI
      //  hips 连线夹角(双重验证)
      let curHipAngle = 0
      if (isVisible(lh) && isVisible(rh)) {
        curHipAngle = (Math.atan2(lh.y - rh.y, lh.x - rh.x) * 180) / Math.PI
      }
      const prevFrames = history.frames
      if (prevFrames.length < 3) return { active: false, confidence: 0, meta: { angle: curAngle } }
      const prev = prevFrames[prevFrames.length - 3].persons[0].landmarks
      const pls = prev[POSE.LEFT_SHOULDER]
      const prs = prev[POSE.RIGHT_SHOULDER]
      if (!isVisible(pls) || !isVisible(prs)) {
        return { active: false, confidence: 0, meta: { angle: curAngle } }
      }
      const prevAngle = (Math.atan2(pls.y - prs.y, pls.x - prs.x) * 180) / Math.PI
      const delta = Math.abs(curAngle - prevAngle)
      //  hips 变化辅助验证
      let hipDelta = 0
      const plh = prev[POSE.LEFT_HIP]
      const prh = prev[POSE.RIGHT_HIP]
      if (isVisible(plh) && isVisible(prh) && isVisible(lh) && isVisible(rh)) {
        const prevHipA = (Math.atan2(plh.y - prh.y, plh.x - prh.x) * 180) / Math.PI
        hipDelta = Math.abs(curHipAngle - prevHipA)
      }
      // 综合判定
      const active = delta > 25 && (delta > 40 || hipDelta > 15)
      let confidence = 0
      if (active) {
        confidence = Math.min(1, delta / 70) * 0.6
        if (hipDelta > 15) confidence += 0.25
        if (delta > 50) confidence += 0.15
      }
      return { active, confidence: Math.min(1, confidence), meta: { angle: curAngle, delta, hipDelta } }
    },
  },
  // ============ 4 种腿部专属动作 ============
  {
    id: 'kick',
    name: '踢腿',
    evaluate: (lm, history) => {
      const lh = lm[POSE.LEFT_HIP]
      const rh = lm[POSE.RIGHT_HIP]
      const lk = lm[POSE.LEFT_KNEE]
      const rk = lm[POSE.RIGHT_KNEE]
      const la = lm[POSE.LEFT_ANKLE]
      const ra = lm[POSE.RIGHT_ANKLE]
      
      if (!isVisible(lh) || !isVisible(lk) || !isVisible(la)) {
        return { active: false, confidence: 0 }
      }

      // 检测时间序列中的腿部运动
      const frames = history.frames
      if (frames.length < 5) return { active: false, confidence: 0 }

      // 分别检测左右腿的踢腿动作
      let leftKickScore = 0
      let rightKickScore = 0
      
      // 左腿踢腿检测
      if (isVisible(la) && isVisible(lk)) {
        const prevLeftAnkle = frames[frames.length - 4].persons[0].landmarks[POSE.LEFT_ANKLE]
        const prevLeftKnee = frames[frames.length - 4].persons[0].landmarks[POSE.LEFT_KNEE]
        
        if (isVisible(prevLeftAnkle) && isVisible(prevLeftKnee)) {
          // 计算脚踝垂直速度
          const leftAnkleVelocity = Math.abs(la.y - prevLeftAnkle.y)
          // 计算膝盖弯曲角度
          const leftKneeAngle = jointAngle(lh, lk, la)
          // 脚踝是否高于膝盖
          const leftAnkleAboveKnee = la.y < lk.y - 0.03
          // 支撑腿（右腿）是否稳定
          const rightLegStable = isVisible(ra) && isVisible(rk) && 
                                Math.abs(ra.y - rk.y) < 0.05 &&
                                Math.abs(rk.y - rh.y) < 0.05
          
          // 多维度评分
          if (leftAnkleAboveKnee && leftAnkleVelocity > 0.06 && leftKneeAngle < 150) {
            leftKickScore = Math.min(1, leftAnkleVelocity * 6) * 0.5
            if (leftKneeAngle < 120) leftKickScore += 0.2
            if (rightLegStable) leftKickScore += 0.2
            if (leftAnkleVelocity > 0.1) leftKickScore += 0.1
          }
        }
      }
      
      // 右腿踢腿检测
      if (isVisible(ra) && isVisible(rk)) {
        const prevRightAnkle = frames[frames.length - 4].persons[0].landmarks[POSE.RIGHT_ANKLE]
        const prevRightKnee = frames[frames.length - 4].persons[0].landmarks[POSE.RIGHT_KNEE]
        
        if (isVisible(prevRightAnkle) && isVisible(prevRightKnee)) {
          const rightAnkleVelocity = Math.abs(ra.y - prevRightAnkle.y)
          const rightKneeAngle = jointAngle(rh, rk, ra)
          const rightAnkleAboveKnee = ra.y < rk.y - 0.03
          const leftLegStable = isVisible(la) && isVisible(lk) && 
                               Math.abs(la.y - lk.y) < 0.05 &&
                               Math.abs(lk.y - lh.y) < 0.05
          
          if (rightAnkleAboveKnee && rightAnkleVelocity > 0.06 && rightKneeAngle < 150) {
            rightKickScore = Math.min(1, rightAnkleVelocity * 6) * 0.5
            if (rightKneeAngle < 120) rightKickScore += 0.2
            if (leftLegStable) rightKickScore += 0.2
            if (rightAnkleVelocity > 0.1) rightKickScore += 0.1
          }
        }
      }
      
      // 取最高分
      const maxScore = Math.max(leftKickScore, rightKickScore)
      const active = maxScore > 0.4
      const confidence = active ? maxScore : 0
      
      return { 
        active, 
        confidence: Math.min(1, confidence), 
        meta: { 
          leftKickScore, 
          rightKickScore,
          ankleVelocity: Math.max(
            isVisible(la) ? Math.abs(la.y - frames[frames.length - 4].persons[0].landmarks[POSE.LEFT_ANKLE].y) : 0,
            isVisible(ra) ? Math.abs(ra.y - frames[frames.length - 4].persons[0].landmarks[POSE.RIGHT_ANKLE].y) : 0
          )
        } 
      }
    },
    correct: () => '踢腿时保持身体平衡，支撑腿微屈',
  },
  {
    id: 'step',
    name: '踏步',
    evaluate: (lm, history) => {
      const lh = lm[POSE.LEFT_HIP]
      const rh = lm[POSE.RIGHT_HIP]
      const lk = lm[POSE.LEFT_KNEE]
      const rk = lm[POSE.RIGHT_KNEE]
      const la = lm[POSE.LEFT_ANKLE]
      const ra = lm[POSE.RIGHT_ANKLE]
      
      if (!isVisible(lh) || !isVisible(lk) || !isVisible(la) || 
          !isVisible(rh) || !isVisible(rk) || !isVisible(ra)) {
        return { active: false, confidence: 0 }
      }

      // 检测交替抬腿动作
      const frames = history.frames
      if (frames.length < 6) return { active: false, confidence: 0 }

      // 计算左右脚踝的相对高度变化
      const leftAnkleY = la.y
      const rightAnkleY = ra.y
      const prevLeftAnkleY = frames[frames.length - 3].persons[0].landmarks[POSE.LEFT_ANKLE].y
      const prevRightAnkleY = frames[frames.length - 3].persons[0].landmarks[POSE.RIGHT_ANKLE].y

      const leftLift = prevLeftAnkleY - leftAnkleY
      const rightLift = prevRightAnkleY - rightAnkleY

      // 计算膝盖弯曲角度
      const leftKneeAngle = jointAngle(lh, lk, la)
      const rightKneeAngle = jointAngle(rh, rk, ra)

      // 踏步特征：左右脚交替抬起 + 膝盖弯曲
      const leftStepping = leftLift > 0.025 && leftKneeAngle < 160
      const rightStepping = rightLift > 0.025 && rightKneeAngle < 160
      const alternating = (leftStepping && rightLift < -0.005) ||
                         (rightStepping && leftLift < -0.005)

      // 验证身体重心稳定（臀部高度变化小）
      const hipStable = Math.abs(lh.y - rh.y) < 0.08

      const active = alternating && hipStable
      let confidence = 0
      if (active) {
        const liftAmount = Math.max(Math.abs(leftLift), Math.abs(rightLift))
        confidence = Math.min(1, liftAmount * 10) * 0.5
        
        // 膝盖弯曲程度加分
        const avgKneeBend = (leftKneeAngle + rightKneeAngle) / 2
        if (avgKneeBend < 140) confidence += 0.2
        else if (avgKneeBend < 160) confidence += 0.1
        
        // 重心稳定加分
        if (hipStable) confidence += 0.2
        
        // 交替幅度加分
        const diff = Math.abs(leftLift - rightLift)
        if (diff > 0.03) confidence += 0.1
      }
      return { active, confidence: Math.min(1, confidence), meta: { leftLift, rightLift } }
    },
    correct: () => '踏步时保持节奏，膝盖抬高',
  },
  {
    id: 'sideStep',
    name: '侧步',
    evaluate: (lm, history) => {
      const lh = lm[POSE.LEFT_HIP]
      const rh = lm[POSE.RIGHT_HIP]
      const lk = lm[POSE.LEFT_KNEE]
      const rk = lm[POSE.RIGHT_KNEE]
      const la = lm[POSE.LEFT_ANKLE]
      const ra = lm[POSE.RIGHT_ANKLE]
      
      if (!isVisible(lh) || !isVisible(lk) || !isVisible(la) || 
          !isVisible(rh) || !isVisible(rk) || !isVisible(ra)) {
        return { active: false, confidence: 0 }
      }

      // 检测横向移动
      const frames = history.frames
      if (frames.length < 5) return { active: false, confidence: 0 }

      // 计算身体重心的横向移动
      const curCenterX = (lh.x + rh.x) / 2
      const prevCenterX = (frames[frames.length - 4].persons[0].landmarks[POSE.LEFT_HIP].x +
                          frames[frames.length - 4].persons[0].landmarks[POSE.RIGHT_HIP].x) / 2
      const lateralMovement = Math.abs(curCenterX - prevCenterX)

      // 计算膝盖弯曲角度
      const leftKneeAngle = jointAngle(lh, lk, la)
      const rightKneeAngle = jointAngle(rh, rk, ra)
      const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2

      // 计算脚踝横向移动（验证确实是侧步而非转身）
      const curAnkleX = (la.x + ra.x) / 2
      const prevAnkleX = (frames[frames.length - 4].persons[0].landmarks[POSE.LEFT_ANKLE].x +
                         frames[frames.length - 4].persons[0].landmarks[POSE.RIGHT_ANKLE].x) / 2
      const ankleLateralMove = Math.abs(curAnkleX - prevAnkleX)

      // 侧步特征：身体横向移动 + 膝盖弯曲 + 脚踝同向移动
      const kneesBent = avgKneeAngle < 160
      const lateralEnough = lateralMovement > 0.04 && ankleLateralMove > 0.03
      
      // 验证纵向移动小（排除上下跳动）
      const curCenterY = (lh.y + rh.y) / 2
      const prevCenterY = (frames[frames.length - 4].persons[0].landmarks[POSE.LEFT_HIP].y +
                          frames[frames.length - 4].persons[0].landmarks[POSE.RIGHT_HIP].y) / 2
      const verticalMovement = Math.abs(curCenterY - prevCenterY)
      const stableVertical = verticalMovement < 0.05

      const active = lateralEnough && kneesBent && stableVertical
      let confidence = 0
      if (active) {
        confidence = Math.min(1, lateralMovement * 10) * 0.5
        
        // 膝盖弯曲程度加分
        if (avgKneeAngle < 140) confidence += 0.2
        else if (avgKneeAngle < 160) confidence += 0.1
        
        // 纵向稳定加分
        if (stableVertical) confidence += 0.2
        
        // 脚踝同向移动加分
        if (ankleLateralMove > 0.04) confidence += 0.1
      }
      return { active, confidence: Math.min(1, confidence), meta: { lateralMovement, kneeAngle: avgKneeAngle } }
    },
    correct: () => '侧步时保持重心稳定，膝盖不要超过脚尖',
  },
  {
    id: 'legRaise',
    name: '抬腿',
    evaluate: (lm, history) => {
      const lh = lm[POSE.LEFT_HIP]
      const rh = lm[POSE.RIGHT_HIP]
      const lk = lm[POSE.LEFT_KNEE]
      const rk = lm[POSE.RIGHT_KNEE]
      const la = lm[POSE.LEFT_ANKLE]
      const ra = lm[POSE.RIGHT_ANKLE]
      
      if (!isVisible(lh) || !isVisible(lk) || !isVisible(la) || 
          !isVisible(rh) || !isVisible(rk) || !isVisible(ra)) {
        return { active: false, confidence: 0 }
      }

      // 检测单腿抬起
      const leftKneeHeight = lh.y - lk.y
      const rightKneeHeight = rh.y - rk.y
      const leftAnkleHeight = lh.y - la.y
      const rightAnkleHeight = rh.y - ra.y

      // 计算膝盖角度
      const leftKneeAngle = jointAngle(lh, lk, la)
      const rightKneeAngle = jointAngle(rh, rk, ra)

      // 多维度验证抬腿
      // 1. 膝盖或脚踝高于臀部
      const leftRaised = leftKneeHeight > 0.08 || leftAnkleHeight > 0.12
      const rightRaised = rightKneeHeight > 0.08 || rightAnkleHeight > 0.12

      // 2. 支撑腿稳定（未抬起的腿）
      let supportLegStable = false
      if (leftRaised && !rightRaised) {
        // 右腿支撑
        supportLegStable = rightKneeAngle > 150 // 支撑腿伸直
      } else if (rightRaised && !leftRaised) {
        // 左腿支撑
        supportLegStable = leftKneeAngle > 150
      } else if (leftRaised && rightRaised) {
        // 双腿抬起（难度更高）
        supportLegStable = true
      }

      // 3. 使用历史帧验证动作持续性（避免单帧误判）
      const frames = history.frames
      let sustained = false
      if (frames.length >= 3) {
        const prevLm = frames[frames.length - 3].persons[0].landmarks
        const prevLk = prevLm[POSE.LEFT_KNEE]
        const prevRk = prevLm[POSE.RIGHT_KNEE]
        const prevLh = prevLm[POSE.LEFT_HIP]
        const prevRh = prevLm[POSE.RIGHT_HIP]
        
        if (isVisible(prevLk) && isVisible(prevRk) && isVisible(prevLh) && isVisible(prevRh)) {
          const prevLeftKneeHeight = prevLh.y - prevLk.y
          const prevRightKneeHeight = prevRh.y - prevRk.y
          
          // 检查是否持续抬腿
          const prevLeftRaised = prevLeftKneeHeight > 0.06
          const prevRightRaised = prevRightKneeHeight > 0.06
          sustained = (leftRaised && prevLeftRaised) || (rightRaised && prevRightRaised)
        }
      }

      const active = (leftRaised || rightRaised) && supportLegStable
      let confidence = 0
      if (active) {
        const maxRaise = Math.max(leftKneeHeight, rightKneeHeight, leftAnkleHeight, rightAnkleHeight)
        confidence = Math.min(1, maxRaise * 5) * 0.5
        
        // 支撑腿稳定加分
        if (supportLegStable) confidence += 0.2
        
        // 膝盖弯曲加分（抬腿时通常弯曲）
        if (leftKneeAngle < 120 || rightKneeAngle < 120) confidence += 0.15
        
        // 持续性加分
        if (sustained) confidence += 0.15
        
        // 双腿抬起额外加分
        if (leftRaised && rightRaised) confidence += 0.1
      }
      return { active, confidence: Math.min(1, confidence), meta: { leftKneeHeight, rightKneeHeight } }
    },
    correct: () => '抬腿时保持上身挺直，核心收紧',
  },
]

// ============ 4 类提示模板 ============

export const promptTemplates: PromptTemplate[] = [
  {
    type: 'encourage',
    messages: ['做得很好,继续保持节奏!', '动作到位,继续保持!', '节奏稳定,继续保持!'],
  },
  {
    type: 'encourage',
    action: 'handRaise',
    messages: ['举手姿势标准!', '手臂伸展到位!'],
  },
  {
    type: 'encourage',
    action: 'squat',
    messages: ['深蹲深度合适,继续!', '膝盖轨迹漂亮!'],
  },
  {
    type: 'correct',
    messages: ['请保持身体居中', '注意呼吸节奏'],
  },
  {
    type: 'correct',
    action: 'squat',
    messages: ['膝盖稍微外展,与脚尖同向', '臀部再向后坐一点', '背部挺直,不要前倾'],
  },
  {
    type: 'correct',
    action: 'bow',
    messages: ['鞠躬角度可以再大一些', '颈部放松,目视脚前'],
  },
  {
    type: 'warn',
    messages: ['请确保全身在画面内', '光线不足,可能影响检测', '请站在距摄像头 1.5-2 米处'],
  },
  {
    type: 'complete',
    messages: ['动作完成,继续下一组!'],
  },
  {
    type: 'complete',
    action: 'squat',
    messages: ['深蹲完成 1 次', '深蹲完成 5 次,休息一下'],
  },
]

// ============ 全局应用配置 ============

export const appConfig = {
  /** MediaPipe wasm 与模型文件,从官方 CDN 加载 - 使用 heavy 版本提升精度 */
  modelPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
  faceModelPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  handModelPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  wasmPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  camera: {
    width: 3840,
    height: 2160,
    facingMode: 'user' as const,
    numPoses: 4,
  },
  detection: {
    minDetectionConfidence: 0.8,
    minTrackingConfidence: 0.8,
    minPresenceConfidence: 0.8,
  },
  ui: {
    mirror: true,
    showWorldLandmarks: false,
    skeletonStyle: {
      lineColor: '#22E3A0',
      pointColor: '#FFB020',
      highlightColor: '#FFFFFF',
    },
  },
  /** 动作连续达标多少帧后触发"完成"提示 */
  completeThreshold: 15,
  /** 防抖窗口大小 */
  historySize: 12,
  /** 提示面板保留条数 */
  maxPrompts: 50,
  /** 提示去重间隔(ms),同一类别在该间隔内只发送一次 */
  promptCooldownMs: 2500,
}

export type AppConfig = typeof appConfig

// ============ 工具函数 ============

/** 根据动作 ID 获取中文名称 */
export function getActionName(id?: string): string | null {
  if (!id) return null
  return actionRules.find((r) => r.id === id)?.name ?? id
}
