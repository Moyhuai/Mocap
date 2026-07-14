// 系统级 Pinia store:摄像头启停、检测结果、提示列表(支持多人)
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { PoseCapture } from '@/modules/PoseCapture'
import { ActionDetector } from '@/modules/ActionDetector'
import { appConfig, actionRules } from '@/modules/config'
import type {
  ActionType,
  MultiDetectionResult,
  PersonDetection,
  PoseFrameResult,
  PromptEntry,
  PromptPayload,
  RunStatus,
  Sensitivity,
} from '@/types'

interface CaptureHandles {
  pose: PoseCapture
  detector: ActionDetector
  unsubscribe: () => void
}

const SENSITIVITY_THRESHOLD: Record<Sensitivity, number> = {
  low: 0.7,
  medium: 0.55,
  high: 0.4,
}

export const useSystemStore = defineStore('system', () => {
  // ============ 状态 ============
  const status = ref<RunStatus>('idle')
  const errorMessage = ref<string>('')
  const fps = ref(0)
  const totalVisibleCount = ref(0)
  const latency = ref(0)
  const detections = ref<PersonDetection[]>([])
  const latestFrame = shallowRef<PoseFrameResult | null>(null)
  const prompts = ref<PromptEntry[]>([])
  const sensitivity = ref<Sensitivity>('medium')
  const mirror = ref<boolean>(appConfig.ui.mirror)
  const enabledActions = ref<Set<ActionType>>(
    new Set(actionRules.map((r) => r.id)),
  )
  const recording = ref(false)
  const recordingStart = ref(0)
  const recordingCount = ref(0)
  const actualResolution = ref('')

  // 模块实例不放入响应式系统
  const handles = shallowRef<CaptureHandles | null>(null)
  let promptId = 0

  // ============ Getters ============
  const isRunning = computed(() => status.value === 'running')
  const personCount = computed(() => detections.value.length)

  // 获取置信度最高的那个人
  const primaryDetection = computed(() => {
    if (!detections.value.length) return null
    return detections.value.reduce((a, b) => a.confidence > b.confidence ? a : b)
  })

  const currentAction = computed(() => primaryDetection.value?.current ?? null)
  const confidence = computed(() => primaryDetection.value?.confidence ?? 0)

  const filteredPrompts = computed(() =>
    prompts.value
      .slice()
      .reverse()
      .slice(0, appConfig.maxPrompts),
  )

  // ============ Actions ============
  async function startCapture(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
    if (status.value === 'running' || status.value === 'loading') return
    status.value = 'loading'
    errorMessage.value = ''
    try {
      const pose = new PoseCapture(video, canvas, {
        width: appConfig.camera.width,
        height: appConfig.camera.height,
        mirror: mirror.value,
        numPoses: appConfig.camera.numPoses,
      })
      await pose.init()
      const detector = new ActionDetector()

      const unsubscribe = pose.onResult((frame) => {
        const t0 = performance.now()
        const result = detector.detect(frame)
        const t1 = performance.now()
        latestFrame.value = frame
        fps.value = frame.fps
        totalVisibleCount.value = result.totalVisibleCount
        latency.value = Math.round((t1 - t0) * 10) / 10

        // 按灵敏度过滤每个人的检测结果
        const threshold = SENSITIVITY_THRESHOLD[sensitivity.value]
        const filteredPersons = result.persons.map((p) => {
          if (p.confidence < threshold && p.current) {
            return { ...p, current: null, confidence: 0 }
          }
          if (p.current && !enabledActions.value.has(p.current)) {
            return { ...p, current: null, confidence: 0 }
          }
          return p
        })
        detections.value = filteredPersons

        // 推送所有提示
        for (const prompt of result.prompts) {
          pushPrompt(prompt)
        }
      })

      pose.start()
      handles.value = { pose, detector, unsubscribe }
      status.value = 'running'

      // 记录实际分辨率
      const w = video.videoWidth
      const h = video.videoHeight
      actualResolution.value = `${w}x${h}`
      console.info(`[Store] 实际分辨率: ${w}x${h}`)
    } catch (e) {
      status.value = 'error'
      errorMessage.value = e instanceof Error ? e.message : String(e)
    }
  }

  function stopCapture(): void {
    if (!handles.value) {
      status.value = 'idle'
      return
    }
    handles.value.unsubscribe()
    handles.value.pose.stop()
    handles.value.detector.reset()
    handles.value = null
    status.value = 'idle'
    detections.value = []
    latestFrame.value = null
    fps.value = 0
    totalVisibleCount.value = 0
    latency.value = 0
    if (recording.value) {
      recording.value = false
    }
  }

  function pushPrompt(p: PromptPayload): void {
    const entry: PromptEntry = {
      id: ++promptId,
      type: p.type,
      message: p.message,
      action: p.action,
      personIndex: p.personIndex,
      timestamp: p.timestamp ?? Date.now(),
    }
    prompts.value.push(entry)
    if (prompts.value.length > appConfig.maxPrompts * 2) {
      prompts.value.splice(0, prompts.value.length - appConfig.maxPrompts)
    }
    if (recording.value && p.type === 'complete') {
      recordingCount.value++
      void sendRecording(entry)
    }
  }

  function clearPrompts(): void {
    prompts.value = []
  }

  function toggleAction(id: ActionType): void {
    const next = new Set(enabledActions.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    enabledActions.value = next
  }

  function setSensitivity(s: Sensitivity): void {
    sensitivity.value = s
  }

  function toggleMirror(): void {
    mirror.value = !mirror.value
    appConfig.ui.mirror = mirror.value
  }

  function toggleRecording(): void {
    if (!recording.value) {
      recording.value = true
      recordingStart.value = Date.now()
      recordingCount.value = 0
    } else {
      recording.value = false
    }
  }

  async function sendRecording(entry: PromptEntry): Promise<void> {
    try {
      await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: entry.action ?? 'unknown',
          timestamp: entry.timestamp,
          durationMs: Date.now() - recordingStart.value,
          confidence: confidence.value,
          personIndex: entry.personIndex,
        }),
      })
    } catch {
      // 静默失败:录制是非关键功能
    }
  }

  return {
    // state
    status,
    errorMessage,
    fps,
    totalVisibleCount,
    latency,
    detections,
    latestFrame,
    prompts,
    sensitivity,
    mirror,
    enabledActions,
    recording,
    recordingCount,
    actualResolution,
    // getters
    isRunning,
    personCount,
    primaryDetection,
    currentAction,
    confidence,
    filteredPrompts,
    // actions
    startCapture,
    stopCapture,
    clearPrompts,
    toggleAction,
    setSensitivity,
    toggleMirror,
    toggleRecording,
  }
})
