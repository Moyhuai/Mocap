// Canvas 2D 可视化:渲染多人骨架与关键点 + 4K 高清 + 面部五官 + 手势识别
import { appConfig, getActionName } from './config'
import { GestureDetector } from './GestureDetector'


import type { PoseFrameResult, RenderExtra, VisualizerOptions } from '@/types'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// MediaPipe Pose 33 关键点骨架连接关系
const POSE_CONNECTIONS: Array<[number, number]> = [
  // 头部
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  // 躯干
  [9, 10],
  [11, 12], [11, 23], [12, 23], [23, 24],
  // 左臂
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // 右臂
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // 左腿
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // 右腿
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
]

// MediaPipe Hand 21 关键点骨架连接关系
const HAND_CONNECTIONS: Array<[number, number]> = [
  // 拇指
  [0, 1], [1, 2], [2, 3], [3, 4],
  // 食指
  [0, 5], [5, 6], [6, 7], [7, 8],
  // 中指
  [0, 9], [9, 10], [10, 11], [11, 12],
  // 无名指
  [0, 13], [13, 14], [14, 15], [15, 16],
  // 小指
  [0, 17], [17, 18], [18, 19], [19, 20],
  // 手掌横向连接
  [5, 9], [9, 13], [13, 17],
]

// MediaPipe Face 478 关键点 - 五官连接关系
// 参考: https://storage.googleapis.com/mediapipe-assets/documentation/mediapipe_face_landmark_fullsize.png
const FACE_CONNECTIONS: { name: string; indices: number[]; color: string }[] = [
  // 左眼 (观众视角的左边，实际是人脸的右边)
  { name: 'leftEye', indices: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], color: '#60A5FA' },
  // 右眼
  { name: 'rightEye', indices: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398], color: '#60A5FA' },
  // 左眉毛
  { name: 'leftEyebrow', indices: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46], color: '#F59E0B' },
  // 右眉毛
  { name: 'rightEyebrow', indices: [336, 296, 334, 293, 300, 276, 283, 282, 295, 285], color: '#F59E0B' },
  // 鼻子
  { name: 'nose', indices: [168, 6, 197, 195, 5, 4, 1, 2, 98, 327], color: '#F43F5E' },
  // 外嘴唇
  { name: 'outerLips', indices: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185], color: '#A855F7' },
  // 内嘴唇
  { name: 'innerLips', indices: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191], color: '#EC4899' },
  // 脸部轮廓
  { name: 'faceOval', indices: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109], color: '#22D3EE' },
]

// 多人区分颜色(每人一个颜色)
const PERSON_COLORS = [
  { line: '#22E3A0', point: '#FFB020', glow: '#22E3A0' },  // 青绿
  { line: '#60A5FA', point: '#F472B6', glow: '#60A5FA' },  // 蓝
  { line: '#F59E0B', point: '#A78BFA', glow: '#F59E0B' },  // 琥珀
  { line: '#F43F5E', point: '#34D399', glow: '#F43F5E' },  // 玫瑰
  { line: '#A855F7', point: '#FBBF24', glow: '#A855F7' },  // 紫
  { line: '#14B8A6', point: '#FB923C', glow: '#14B8A6' },  // 青
]

export class Visualizer {
  private ctx: CanvasRenderingContext2D
  private opts: Required<VisualizerOptions>
  private width = 0
  private height = 0
  private gestureDetector: GestureDetector

  constructor(ctx: CanvasRenderingContext2D, opts?: VisualizerOptions) {
    this.ctx = ctx
    this.opts = {
      lineWidth: opts?.lineWidth ?? 3,
      pointRadius: opts?.pointRadius ?? 4,
      accentColor: opts?.accentColor ?? appConfig.ui.skeletonStyle.highlightColor,
    }
    this.gestureDetector = new GestureDetector()
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    const dpr = window.devicePixelRatio || 1
    this.ctx.canvas.width = width * dpr
    this.ctx.canvas.height = height * dpr
    this.ctx.canvas.style.width = `${width}px`
    this.ctx.canvas.style.height = `${height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height)
  }

  render(frame: PoseFrameResult, extra?: RenderExtra): void {
    this.clear()
    if (!frame?.persons?.length) return

    const w = this.width
    const h = this.height

    // 镜像翻转
    this.ctx.save()
    if (appConfig.ui.mirror) {
      this.ctx.translate(w, 0)
      this.ctx.scale(-1, 1)
    }

    // 为每个人渲染骨架
    for (let pi = 0; pi < frame.persons.length; pi++) {
      const person = frame.persons[pi]
      const lm = person.landmarks
      if (!lm?.length) continue

      const colors = PERSON_COLORS[pi % PERSON_COLORS.length]
      const detection = extra?.detections?.find((d) => d.index === pi)

      // 1. 骨架连线
      this.ctx.lineWidth = this.opts.lineWidth
      this.ctx.strokeStyle = colors.line
      this.ctx.shadowColor = colors.glow
      this.ctx.shadowBlur = 10
      this.ctx.beginPath()
      for (const [a, b] of POSE_CONNECTIONS) {
        const pa = lm[a]
        const pb = lm[b]
        if (!pa || !pb) continue
        if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue
        this.ctx.moveTo(pa.x * w, pa.y * h)
        this.ctx.lineTo(pb.x * w, pb.y * h)
      }
      this.ctx.stroke()
      this.ctx.shadowBlur = 0

      // 2. 关键点
      this.ctx.fillStyle = colors.point
      for (let i = 0; i < lm.length; i++) {
        const p = lm[i]
        if (!p || (p.visibility ?? 1) < 0.3) continue
        this.ctx.beginPath()
        this.ctx.arc(p.x * w, p.y * h, this.opts.pointRadius, 0, Math.PI * 2)
        this.ctx.fill()
      }

      // 3. 高亮当前动作相关关节
      if (detection?.current) {
        const highlightIndices = this.highlightJoints(detection.current)
        this.ctx.fillStyle = this.opts.accentColor
        this.ctx.shadowColor = this.opts.accentColor
        this.ctx.shadowBlur = 18
        for (const idx of highlightIndices) {
          const p = lm[idx]
          if (!p || (p.visibility ?? 1) < 0.3) continue
          this.ctx.beginPath()
          this.ctx.arc(p.x * w, p.y * h, this.opts.pointRadius + 4, 0, Math.PI * 2)
          this.ctx.fill()
        }
        this.ctx.shadowBlur = 0
      }

      // 4. 人物标签(编号 + 动作名)
      this.ctx.shadowBlur = 0
      this.ctx.font = 'bold 13px "Cascadia Code", "Consolas", monospace'
      const label = `P${pi + 1}${detection?.current ? ' · ' + this.actionName(detection.current) : ''}`
      const textMetrics = this.ctx.measureText(label)
      const nose = lm[0]
      if (nose && (nose.visibility ?? 1) >= 0.3) {
        const lx = nose.x * w
        const ly = nose.y * h - 20
        this.ctx.fillStyle = 'rgba(0,0,0,0.6)'
        this.ctx.fillRect(lx - textMetrics.width / 2 - 6, ly - 14, textMetrics.width + 12, 20)
        this.ctx.fillStyle = colors.line
        this.ctx.fillText(label, lx - textMetrics.width / 2, ly)
      }

      // 5. 渲染面部五官
      if (person.faceLandmarks && person.faceLandmarks.length > 0) {
        this.renderFace(person.faceLandmarks, w, h, colors.line)
      }

      // 6. 渲染手部关键点 + 手势识别
      if (person.handLandmarks && person.handLandmarks.length > 0) {
        const gestures = this.gestureDetector.detect(person.handLandmarks)
        for (let hi = 0; hi < person.handLandmarks.length; hi++) {
          const hand = person.handLandmarks[hi]
          if (!hand?.length) continue
          this.renderHand(hand, w, h, colors.line)

          // 显示识别到的手势标签
          const gesture = gestures.find(g => g.handIndex === hi)
          if (gesture?.gesture) {
            const wrist = hand[0]
            if (wrist) {
              const gestureName = gesture.gesture
              this.ctx.font = 'bold 12px "Cascadia Code", "Consolas", monospace'
              const textMetrics = this.ctx.measureText(gestureName)
              const gx = wrist.x * w
              const gy = wrist.y * h + 20
              this.ctx.fillStyle = 'rgba(0,0,0,0.6)'
              this.ctx.fillRect(gx - textMetrics.width / 2 - 4, gy - 10, textMetrics.width + 8, 16)
              this.ctx.fillStyle = '#FBBF24'
              this.ctx.fillText(gestureName, gx - textMetrics.width / 2, gy)
            }
          }
        }
      }
    }

    // 渲染物品检测框
    if (frame.objects && frame.objects.length > 0) {
      this.renderObjects(frame.objects, w, h)
    }

    this.ctx.restore()
  }

  /** 渲染物品检测框 */
  private renderObjects(objects: Array<{ class: string; score: number; bbox: [number, number, number, number] }>, w: number, h: number): void {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F']
    
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      const [x, y, width, height] = obj.bbox
      const color = colors[i % colors.length]
      
      // 绘制边框
      this.ctx.strokeStyle = color
      this.ctx.lineWidth = 3
      this.ctx.shadowColor = color
      this.ctx.shadowBlur = 8
      this.ctx.strokeRect(x * w, y * h, width * w, height * h)
      this.ctx.shadowBlur = 0
      
      // 绘制标签背景
      const label = `${obj.class} ${Math.round(obj.score * 100)}%`
      this.ctx.font = 'bold 12px "Cascadia Code", "Consolas", monospace'
      const textMetrics = this.ctx.measureText(label)
      const labelHeight = 20
      const labelWidth = textMetrics.width + 12
      
      this.ctx.fillStyle = color
      this.ctx.fillRect(x * w, y * h - labelHeight, labelWidth, labelHeight)
      
      // 绘制标签文字
      this.ctx.fillStyle = '#FFFFFF'
      this.ctx.fillText(label, x * w + 6, y * h - 6)
    }
  }

  /** 渲染面部五官:眼睛、眉毛、鼻子、嘴巴、脸部轮廓 */
  private renderFace(faceLandmarks: NormalizedLandmark[], w: number, h: number, accentColor: string): void {
    // 渲染各五官的连线
    for (const feature of FACE_CONNECTIONS) {
      const indices = feature.indices
      // 使用特征颜色,脸部轮廓用半透明
      const isOval = feature.name === 'faceOval'
      this.ctx.strokeStyle = isOval ? 'rgba(34, 211, 238, 0.3)' : feature.color
      this.ctx.lineWidth = isOval ? 1 : 2
      this.ctx.shadowColor = feature.color
      this.ctx.shadowBlur = isOval ? 0 : 6

      this.ctx.beginPath()
      let started = false
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i]
        const p = faceLandmarks[idx]
        if (!p) continue
        const px = p.x * w
        const py = p.y * h
        if (!started) {
          this.ctx.moveTo(px, py)
          started = true
        } else {
          this.ctx.lineTo(px, py)
        }
      }
      // 眼睛和嘴唇闭合
      if (feature.name.includes('Eye') || feature.name.includes('Lips')) {
        this.ctx.closePath()
      }
      this.ctx.stroke()
      this.ctx.shadowBlur = 0
    }

    // 渲染眼睛瞳孔(虹膜区域)
    this.renderIris(faceLandmarks, [468, 469, 470, 471, 472], w, h, '#60A5FA') // 左眼虹膜
    this.renderIris(faceLandmarks, [473, 474, 475, 476, 477], w, h, '#60A5FA') // 右眼虹膜
  }

  /** 渲染手部关键点 */
  private renderHand(handLandmarks: NormalizedLandmark[], w: number, h: number, color: string): void {
    // 手部连线
    this.ctx.strokeStyle = color
    this.ctx.lineWidth = 2
    this.ctx.shadowColor = color
    this.ctx.shadowBlur = 4

    this.ctx.beginPath()
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = handLandmarks[a]
      const pb = handLandmarks[b]
      if (!pa || !pb) continue
      this.ctx.moveTo(pa.x * w, pa.y * h)
      this.ctx.lineTo(pb.x * w, pb.y * h)
    }
    this.ctx.stroke()
    this.ctx.shadowBlur = 0

    // 手部关键点
    this.ctx.fillStyle = color
    for (const p of handLandmarks) {
      if (!p) continue
      this.ctx.beginPath()
      this.ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2)
      this.ctx.fill()
    }
  }

  /** 渲染虹膜区域 */
  private renderIris(faceLandmarks: NormalizedLandmark[], indices: number[], w: number, h: number, color: string): void {
    const points = indices.map(i => faceLandmarks[i]).filter(Boolean)
    if (points.length < 3) return

    // 计算中心点
    let cx = 0, cy = 0
    for (const p of points) {
      cx += p.x * w
      cy += p.y * h
    }
    cx /= points.length
    cy /= points.length

    // 计算半径
    let maxR = 0
    for (const p of points) {
      const dx = p.x * w - cx
      const dy = p.y * h - cy
      const r = Math.sqrt(dx * dx + dy * dy)
      if (r > maxR) maxR = r
    }

    // 绘制虹膜圆
    this.ctx.fillStyle = color
    this.ctx.globalAlpha = 0.5
    this.ctx.beginPath()
    this.ctx.arc(cx, cy, maxR * 0.7, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.globalAlpha = 1.0

    // 绘制瞳孔
    this.ctx.fillStyle = '#1a1a2e'
    this.ctx.beginPath()
    this.ctx.arc(cx, cy, maxR * 0.3, 0, Math.PI * 2)
    this.ctx.fill()
  }

  /** 不同动作高亮不同关节 */
  private highlightJoints(action: string): number[] {
    switch (action) {
      case 'handRaise':
        return [11, 12, 13, 14, 15, 16]
      case 'squat':
        return [23, 24, 25, 26, 27, 28]
      case 'jump':
        return [27, 28]
      case 'bow':
        return [11, 12, 23, 24]
      case 'wave':
        return [12, 14, 16]
      case 'turn':
        return [11, 12]
      case 'kick':
        return [25, 26, 27, 28] // 膝盖和脚踝
      case 'step':
        return [27, 28] // 脚踝
      case 'sideStep':
        return [27, 28] // 脚踝
      case 'legRaise':
        return [25, 26, 27, 28] // 膝盖和脚踝
      default:
        return []
    }
  }

  private actionName(id: string): string {
    return getActionName(id) ?? id
  }
}
