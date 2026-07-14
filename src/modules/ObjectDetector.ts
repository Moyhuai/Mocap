// 物品检测器 - 基于 coco-ssd 识别 80 类常见物品
import * as cocoSsd from '@tensorflow-models/coco-ssd'
import * as tf from '@tensorflow/tfjs'
import type { ObjectDetection } from '@/types'

export class ObjectDetector {
  private model: cocoSsd.ObjectDetection | null = null
  private loading = false
  private loadError: string | null = null

  async init(): Promise<void> {
    if (this.model || this.loading) return

    this.loading = true
    try {
      // 确保 TensorFlow.js 后端就绪
      await tf.ready()
      
      // 加载 coco-ssd 模型（使用 mobilenet_v2 提升精度）
      // 可选模型：lite_mobilenet_v2（轻量）、mobilenet_v2（标准）、ssd_mobilenet_v2（高精度）
      this.model = await cocoSsd.load({
        base: 'mobilenet_v2', // 从 lite 升级到标准版本，提升检测精度
      })
      
      console.info('[ObjectDetector] coco-ssd 模型加载完成 (mobilenet_v2)')
    } catch (e) {
      this.loadError = e instanceof Error ? e.message : String(e)
      console.error('[ObjectDetector] 模型加载失败:', this.loadError)
    } finally {
      this.loading = false
    }
  }

  async detect(video: HTMLVideoElement): Promise<ObjectDetection[]> {
    if (!this.model) {
      if (!this.loading) {
        await this.init()
      }
      return []
    }

    try {
      // 执行检测 - 提升精度参数
      // maxDetection: 20 -> 30（检测更多物品）
      // scoreThreshold: 0.5 -> 0.4（降低阈值，捕获更多物品）
      const predictions = await this.model.detect(video, 30, 0.4)
      
      // 转换为统一格式
      const detections: ObjectDetection[] = predictions.map(pred => ({
        class: pred.class,
        score: pred.score,
        bbox: [
          pred.bbox[0] / video.videoWidth,  // x
          pred.bbox[1] / video.videoHeight, // y
          pred.bbox[2] / video.videoWidth,  // width
          pred.bbox[3] / video.videoHeight, // height
        ],
      }))

      return detections
    } catch (e) {
      console.error('[ObjectDetector] 检测失败:', e)
      return []
    }
  }

  isReady(): boolean {
    return this.model !== null
  }

  getError(): string | null {
    return this.loadError
  }
}
