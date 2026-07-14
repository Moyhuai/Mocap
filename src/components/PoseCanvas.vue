<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, shallowRef } from 'vue'
import { useSystemStore } from '@/stores/system'
import { Visualizer } from '@/modules/Visualizer'
import { getActionName } from '@/modules/config'
import { Camera, CameraOff, Loader2, Users } from 'lucide-vue-next'

const store = useSystemStore()
const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const visualizer = shallowRef<Visualizer | null>(null)

onMounted(() => {
  if (!canvasRef.value || !containerRef.value) return
  const ctx = canvasRef.value.getContext('2d')
  if (!ctx) return
  visualizer.value = new Visualizer(ctx)
  resize()
  window.addEventListener('resize', resize)
  requestAnimationFrame(renderLoop)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  store.stopCapture()
})

function resize(): void {
  if (!containerRef.value || !canvasRef.value || !visualizer.value) return
  const rect = containerRef.value.getBoundingClientRect()
  visualizer.value.resize(rect.width, rect.height)
}

/** 节流渲染:目标 30 FPS,避免每帧都重绘导致 RAF handler 超时 */
const TARGET_FPS = 30
const FRAME_INTERVAL = 1000 / TARGET_FPS
let lastRenderTime = 0

function renderLoop(now: number): void {
  if (now - lastRenderTime >= FRAME_INTERVAL) {
    lastRenderTime = now
    if (visualizer.value) {
      const frame = store.latestFrame
      if (frame) {
        visualizer.value.render(frame, {
          detections: store.detections,
        })
      } else {
        visualizer.value.clear()
      }
    }
  }
  requestAnimationFrame(renderLoop)
}

async function toggleCapture(): Promise<void> {
  if (store.isRunning) {
    store.stopCapture()
    return
  }
  if (!videoRef.value || !canvasRef.value) return
  await store.startCapture(videoRef.value, canvasRef.value)
}

watch(() => store.status, () => {
  // 状态变化时强制 resize 一次,确保 Canvas 与容器尺寸同步
  requestAnimationFrame(resize)
})

/** 预处理检测信息,避免模板中重复调用 getActionName */
const enrichedDetections = computed(() =>
  store.detections.map((d) => ({
    ...d,
    actionLabel: getActionName(d.current) ?? '—',
    confidencePct: Math.round(d.confidence * 100),
  }))
)
</script>

<template>
  <div
    ref="containerRef"
    class="relative w-full h-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80 backdrop-blur"
    :class="{ 'ring-2 ring-emerald-400/50': store.isRunning }"
  >
    <div class="absolute inset-0 grid-bg pointer-events-none" aria-hidden="true"></div>

    <video
      ref="videoRef"
      class="absolute inset-0 w-full h-full object-cover"
      :class="{ 'opacity-0': !store.isRunning, 'scale-x-[-1]': store.mirror }"
      playsinline
      muted
    />
    <canvas ref="canvasRef" class="absolute inset-0 w-full h-full" />

    <div
      v-if="store.status === 'loading'"
      class="absolute inset-0 flex items-center justify-center bg-zinc-950/80 text-zinc-300"
    >
      <Loader2 class="w-6 h-6 animate-spin mr-2" />
      <span class="font-mono text-sm">正在加载 MediaPipe 模型...</span>
    </div>

    <div
      v-else-if="store.status === 'error'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/90 text-zinc-200 p-6"
    >
      <CameraOff class="w-10 h-10 text-rose-400" />
      <p class="text-sm font-mono text-rose-300">{{ store.errorMessage || '摄像头无法启动' }}</p>
      <p class="text-xs text-zinc-500">请检查浏览器权限设置或换用 Chrome / Edge 浏览器</p>
    </div>

    <div
      v-else-if="store.status === 'idle'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/60"
    >
      <button
        class="group flex flex-col items-center gap-3 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-8 py-6 transition hover:bg-emerald-400/20 hover:border-emerald-400/60"
        @click="toggleCapture"
      >
        <Camera class="w-10 h-10 text-emerald-300 transition group-hover:scale-110" />
        <span class="text-sm font-semibold tracking-wide text-emerald-200">启动摄像头</span>
      </button>
      <p class="text-xs text-zinc-500 font-mono">视频帧仅在本地处理,不会上传</p>
      <p class="text-xs text-zinc-600 font-mono">支持 4K · 最多 4 人同时识别</p>
    </div>

    <!-- 多人检测信息条 -->
    <div
      v-if="store.isRunning"
      class="absolute top-4 left-4 right-4 flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/70 px-4 py-2 backdrop-blur"
    >
      <div class="flex items-center gap-2">
        <Users class="w-4 h-4 text-emerald-400" />
        <span class="text-sm font-semibold text-emerald-300">
          {{ store.personCount }} 人
        </span>
      </div>

      <div class="flex-1 flex items-center gap-2 overflow-x-auto">
        <div
          v-for="d in enrichedDetections"
          :key="d.index"
          class="flex-shrink-0 flex items-center gap-1.5 rounded-md bg-zinc-800/60 px-2 py-1 text-xs"
        >
          <span class="font-mono text-zinc-400">P{{ d.index + 1 }}</span>
          <span class="font-semibold text-emerald-300">{{ d.actionLabel }}</span>
          <span class="font-mono text-amber-300">{{ d.confidencePct }}%</span>
        </div>
      </div>
    </div>

    <button
      v-if="store.isRunning"
      class="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20"
      @click="toggleCapture"
    >
      <CameraOff class="w-4 h-4" />
      停止
    </button>

    <div
      v-if="store.recording"
      class="absolute top-20 right-4 flex items-center gap-2 rounded-md bg-rose-500/20 px-3 py-1 text-xs font-mono text-rose-300"
    >
      <span class="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>
      REC · {{ store.recordingCount }}
    </div>

  </div>
</template>

<style scoped>
.grid-bg {
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse at center, black 50%, transparent 100%);
}
</style>
