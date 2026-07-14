// MediaPipe 姿态捕捉封装 - 支持 4K + 多人检测 + 面部五官 + 手势识别 + 物品检测
import { PoseLandmarker, FaceLandmarker, HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { appConfig } from './config'
import { ObjectDetector } from './ObjectDetector'
import type { PoseCaptureOptions, PoseFrameResult } from '@/types'

export class PoseCapture {
  private video: HTMLVideoElement
  private options: Required<PoseCaptureOptions>
  private landmarker: PoseLandmarker | null = null
  private faceLandmarker: FaceLandmarker | null = null
  private handLandmarker: HandLandmarker | null = null
  private objectDetector: ObjectDetector | null = null
  private stream: MediaStream | null = null
  private rafId: number | null = null
  private running = false
  private lastTs = 0
  private fps = 0
  private fpsEma = 0
  private listeners = new Set<(r: PoseFrameResult) => void>()

  constructor(video: HTMLVideoElement, _canvas: HTMLCanvasElement, opts?: PoseCaptureOptions) {
    this.video = video
    this.options = {
      width: opts?.width ?? appConfig.camera.width,
      height: opts?.height ?? appConfig.camera.height,
      mirror: opts?.mirror ?? appConfig.ui.mirror,
      numPoses: opts?.numPoses ?? appConfig.camera.numPoses,
    }
  }

  /** 加载 wasm + 模型,并请求摄像头(支持 4K) */
  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(appConfig.wasmPath)
    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: appConfig.modelPath,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: this.options.numPoses,
      minPoseDetectionConfidence: appConfig.detection.minDetectionConfidence,
      minPosePresenceConfidence: appConfig.detection.minPresenceConfidence,
      minTrackingConfidence: appConfig.detection.minTrackingConfidence,
    })

    // 初始化面部关键点检测器
    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: appConfig.faceModelPath,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: this.options.numPoses,
      minFaceDetectionConfidence: appConfig.detection.minDetectionConfidence,
      minFacePresenceConfidence: appConfig.detection.minPresenceConfidence,
      minTrackingConfidence: appConfig.detection.minTrackingConfidence,
    })

    // 初始化手部关键点检测器(支持手势识别)
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: appConfig.handModelPath,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: this.options.numPoses * 2, // 每人最多 2 只手
      minHandDetectionConfidence: appConfig.detection.minDetectionConfidence,
      minHandPresenceConfidence: appConfig.detection.minPresenceConfidence,
      minTrackingConfidence: appConfig.detection.minTrackingConfidence,
    })

    // 初始化物品检测器(coco-ssd)
    this.objectDetector = new ObjectDetector()
    await this.objectDetector.init()

    // 请求 4K 摄像头(3840x2160),浏览器会返回设备支持的最高分辨率
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: this.options.width },
        height: { ideal: this.options.height },
        facingMode: appConfig.camera.facingMode,
        // 4K 需要高帧率支持
        frameRate: { ideal: 30, min: 15 },
      },
      audio: false,
    })

    this.video.srcObject = this.stream
    this.video.muted = true
    this.video.playsInline = true
    await this.video.play()

    // 记录实际分辨率
    const actualW = this.video.videoWidth
    const actualH = this.video.videoHeight
    console.info(
      `[PoseCapture] 摄像头分辨率: ${actualW}x${actualH} (请求: ${this.options.width}x${this.options.height})`,
    )
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTs = performance.now()
    this.loop()
  }

  stop(): void {
    this.running = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.video) {
      this.video.srcObject = null
    }
    if (this.landmarker) {
      try {
        this.landmarker.close()
      } catch {
        // ignore
      }
      this.landmarker = null
    }
    if (this.faceLandmarker) {
      try {
        this.faceLandmarker.close()
      } catch {
        // ignore
      }
      this.faceLandmarker = null
    }
    if (this.handLandmarker) {
      try {
        this.handLandmarker.close()
      } catch {
        // ignore
      }
      this.handLandmarker = null
    }
  }

  onResult(cb: (r: PoseFrameResult) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private loop = async (): Promise<void> => {
    if (!this.running || !this.landmarker) return
    const now = performance.now()
    const videoReady = this.video.readyState >= 2
    if (videoReady && this.video.currentTime > 0) {
      const ts = now
      let result
      let faceResult
      try {
        result = this.landmarker.detectForVideo(this.video, ts)
      } catch {
        result = null
      }

      // 面部检测
      if (this.faceLandmarker) {
        try {
          faceResult = this.faceLandmarker.detectForVideo(this.video, ts)
        } catch {
          faceResult = null
        }
      }

      // 手部检测(手势识别)
      let handResult
      if (this.handLandmarker) {
        try {
          handResult = this.handLandmarker.detectForVideo(this.video, ts)
        } catch {
          handResult = null
        }
      }

      // 物品检测(coco-ssd) - 每2帧检测一次以提升捕获率
      let objectResult: any[] = []
      if (this.objectDetector && Math.floor(ts / 100) % 2 === 0) {
        try {
          objectResult = await this.objectDetector.detect(this.video)
        } catch {
          objectResult = []
        }
      }

      // 计算 FPS(EMA 平滑)
      const dt = now - this.lastTs
      this.lastTs = now
      if (dt > 0) {
        const instantFps = 1000 / dt
        this.fpsEma = this.fpsEma === 0 ? instantFps : this.fpsEma * 0.85 + instantFps * 0.15
        this.fps = Math.round(this.fpsEma)
      }

      // 多人数据: result.landmarks 是 NormalizedLandmark[][]
      const poseLandmarks = result?.landmarks ?? []
      const faceLandmarks = faceResult?.faceLandmarks ?? []
      const handLandmarks = handResult?.landmarks ?? []

      // 将手部关键点与身体关键点关联（基于手腕位置匹配）
      const matchHands = (personLandmarks: typeof poseLandmarks[0]): typeof handLandmarks => {
        const matchedHands: typeof handLandmarks = []
        const leftWrist = personLandmarks[15] // MediaPipe Pose 左手腕
        const rightWrist = personLandmarks[16] // MediaPipe Pose 右手腕

        for (const hand of handLandmarks) {
          const wrist = hand[0] // 手部关键点索引 0 是手腕
          if (!wrist) continue

          // 计算与左右手腕的距离
          const leftDist = leftWrist ? Math.sqrt(
            Math.pow(wrist.x - leftWrist.x, 2) + Math.pow(wrist.y - leftWrist.y, 2)
          ) : Infinity
          const rightDist = rightWrist ? Math.sqrt(
            Math.pow(wrist.x - rightWrist.x, 2) + Math.pow(wrist.y - rightWrist.y, 2)
          ) : Infinity

          // 阈值 0.2 表示合理匹配范围
          if (leftDist < 0.2 || rightDist < 0.2) {
            matchedHands.push(hand)
          }
        }
        return matchedHands
      }

      // 将面部关键点与身体关键点关联（基于鼻子位置匹配）
      const persons = poseLandmarks.map((landmarks, i) => {
        const nose = landmarks[0] // MediaPipe Pose 的鼻子关键点
        let matchedFace: typeof faceLandmarks[0] | undefined

        if (nose && faceLandmarks.length > 0) {
          // 找到距离身体鼻子最近的面部
          let minDist = Infinity
          for (const face of faceLandmarks) {
            // 面部关键点索引 1 是鼻尖
            const faceNose = face[1]
            if (faceNose) {
              const dist = Math.sqrt(
                Math.pow(nose.x - faceNose.x, 2) + Math.pow(nose.y - faceNose.y, 2)
              )
              if (dist < minDist && dist < 0.15) { // 阈值 0.15 表示合理匹配范围
                minDist = dist
                matchedFace = face
              }
            }
          }
        }

        return {
          landmarks,
          worldLandmarks: result?.worldLandmarks?.[i],
          faceLandmarks: matchedFace,
          handLandmarks: matchHands(landmarks),
        }
      })

      const frame: PoseFrameResult = {
        persons,
        timestampMs: ts,
        fps: this.fps,
        objects: objectResult,
      }
      this.listeners.forEach((cb) => cb(frame))
    }
    this.rafId = requestAnimationFrame(this.loop)
  }
}
