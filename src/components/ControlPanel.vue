<script setup lang="ts">
import { useSystemStore } from '@/stores/system'
import { Settings2, FlipHorizontal, Circle, Sliders } from 'lucide-vue-next'
import type { Sensitivity } from '@/types'

const store = useSystemStore()

const sensitivityOptions: Array<{ value: Sensitivity; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]
</script>

<template>
  <div class="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 backdrop-blur space-y-5">
    <header class="flex items-center gap-2 border-b border-zinc-800 pb-3">
      <Settings2 class="w-4 h-4 text-amber-300" />
      <h3 class="text-sm font-semibold tracking-wide text-zinc-200">控制面板</h3>
    </header>

    <!-- 灵敏度 -->
    <section>
      <div class="flex items-center gap-2 mb-2">
        <Sliders class="w-3.5 h-3.5 text-zinc-500" />
        <span class="text-xs uppercase tracking-widest text-zinc-500 font-mono">Sensitivity</span>
      </div>
      <div class="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 p-1">
        <button
          v-for="opt in sensitivityOptions"
          :key="opt.value"
          class="rounded-md py-1.5 text-xs font-mono transition"
          :class="store.sensitivity === opt.value
            ? 'bg-emerald-500/20 text-emerald-300'
            : 'text-zinc-400 hover:bg-zinc-800'"
          @click="store.setSensitivity(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </section>

    <!-- 镜像 -->
    <section class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <FlipHorizontal class="w-3.5 h-3.5 text-zinc-500" />
        <span class="text-xs uppercase tracking-widest text-zinc-500 font-mono">Mirror</span>
      </div>
      <button
        class="relative h-5 w-10 rounded-full transition"
        :class="store.mirror ? 'bg-emerald-500/60' : 'bg-zinc-700'"
        @click="store.toggleMirror"
      >
        <span
          class="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
          :class="{ 'left-0.5': !store.mirror, 'left-[1.375rem]': store.mirror }"
        />
      </button>
    </section>

    <!-- 录制 -->
    <section class="border-t border-zinc-800 pt-4">
      <button
        class="flex w-full items-center justify-between rounded-lg border px-3 py-2 transition"
        :class="store.recording
          ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          : 'border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700'"
        :disabled="!store.isRunning"
        @click="store.toggleRecording"
      >
        <span class="flex items-center gap-2">
          <Circle class="w-3 h-3" :class="{ 'fill-rose-400 text-rose-400 animate-pulse': store.recording }" />
          <span class="text-xs font-semibold uppercase tracking-widest font-mono">
            {{ store.recording ? '停止录制' : '开始录制' }}
          </span>
        </span>
        <span v-if="store.recording" class="text-xs font-mono">{{ store.recordingCount }} 条</span>
      </button>
      <p class="mt-2 text-[10px] text-zinc-600 leading-relaxed">
        录制模式下,每完成一次动作将上传一条记录到服务端
      </p>
    </section>
  </div>
</template>
