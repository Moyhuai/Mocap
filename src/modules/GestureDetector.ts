// 手势检测器:基于 MediaPipe HandLandmarker 21 关键点识别 6 种常见手势
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { GestureType, GestureResult } from '@/types'

// MediaPipe Hand 21 关键点索引
const H = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
} as const

type Landmark = NormalizedLandmark

const dist = (a: Landmark, b: Landmark): number =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + ((a.z ?? 0) - (b.z ?? 0)) ** 2)

/** 判断手指是否伸直:指尖到手腕距离 > PIP 关节到手腕距离 */
const isFingerExtended = (lm: Landmark[], tip: number, pip: number): boolean => {
  const wrist = lm[H.WRIST]
  return dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.1
}

/** 判断拇指是否伸直:拇指尖端到食指 MCP 距离 > 拇指 IP 到食指 MCP */
const isThumbExtended = (lm: Landmark[]): boolean => {
  return dist(lm[H.THUMB_TIP], lm[H.INDEX_MCP]) > dist(lm[H.THUMB_IP], lm[H.INDEX_MCP]) * 1.1
}

/** 识别单只手的手势 */
function recognizeSingleHand(lm: Landmark[]): { gesture: GestureType; confidence: number } {
  if (!lm || lm.length < 21) return { gesture: null, confidence: 0 }

  const thumb = isThumbExtended(lm)
  const index = isFingerExtended(lm, H.INDEX_TIP, H.INDEX_PIP)
  const middle = isFingerExtended(lm, H.MIDDLE_TIP, H.MIDDLE_PIP)
  const ring = isFingerExtended(lm, H.RING_TIP, H.RING_PIP)
  const pinky = isFingerExtended(lm, H.PINKY_TIP, H.PINKY_PIP)

  const extended = [thumb, index, middle, ring, pinky]
  const extendedCount = extended.filter(Boolean).length

  // 握拳: 所有手指弯曲
  if (extendedCount === 0) {
    return { gesture: 'fist', confidence: 0.9 }
  }

  // 张开: 所有手指伸直
  if (extendedCount === 5) {
    return { gesture: 'open', confidence: 0.95 }
  }

  // 点赞: 仅拇指伸直
  if (thumb && !index && !middle && !ring && !pinky) {
    // 额外验证: 拇指向上 (拇指尖端 y 值小于拇指 MCP y 值)
    if (lm[H.THUMB_TIP].y < lm[H.THUMB_MCP].y - 0.02) {
      return { gesture: 'thumbsUp', confidence: 0.85 }
    }
    return { gesture: 'pointing', confidence: 0.6 }
  }

  // OK 手势: 拇指和食指指尖接近, 其余手指伸直
  const thumbIndexDist = dist(lm[H.THUMB_TIP], lm[H.INDEX_TIP])
  const handSize = dist(lm[H.WRIST], lm[H.MIDDLE_MCP])
  if (thumbIndexDist < handSize * 0.25 && middle && ring && pinky) {
    return { gesture: 'ok', confidence: 0.85 }
  }

  // 剪刀/胜利: 食指和中指伸直, 其余弯曲
  if (index && middle && !ring && !pinky) {
    return { gesture: 'peace', confidence: 0.85 }
  }

  // 指向: 仅食指伸直
  if (!thumb && index && !middle && !ring && !pinky) {
    return { gesture: 'pointing', confidence: 0.8 }
  }

  return { gesture: null, confidence: 0 }
}

export class GestureDetector {
  /** 检测所有手的手势 */
  detect(hands: NormalizedLandmark[][]): GestureResult[] {
    if (!hands?.length) return []
    return hands.map((hand, i) => {
      const result = recognizeSingleHand(hand)
      return {
        gesture: result.gesture,
        confidence: result.confidence,
        handIndex: i,
      }
    }).filter(r => r.gesture !== null)
  }
}

