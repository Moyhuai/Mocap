<script setup lang="ts">
import { computed } from 'vue'
import { useSystemStore } from '@/stores/system'
import { getActionName } from '@/modules/config'
import { Bell, Trash2, CheckCircle2, AlertTriangle, Lightbulb, Sparkles } from 'lucide-vue-next'
import type { PromptType } from '@/types'

const store = useSystemStore()

const typeMeta: Record<PromptType, { color: string; barBg: string; icon: typeof Bell; label: string }> = {
  encourage: { color: 'text-emerald-400', barBg: 'bg-emerald-400', icon: Sparkles, label: '鼓励' },
  correct: { color: 'text-cyan-400', barBg: 'bg-cyan-400', icon: Lightbulb, label: '纠正' },
  warn: { color: 'text-amber-400', barBg: 'bg-amber-400', icon: AlertTriangle, label: '警告' },
  complete: { color: 'text-blue-400', barBg: 'bg-blue-400', icon: CheckCircle2, label: '完成' },
}

const prompts = computed(() =>
  store.filteredPrompts.map((p) => ({
    ...p,
    actionName: p.action ? getActionName(p.action) : null,
  }))
)

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}
</script>

<template>
  <div class="relative flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-950/60 backdrop-blur">
    <!-- 背景氛围层 -->
    <div class="absolute inset-0 -z-10">
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(34,227,160,0.05),_transparent_60%)]"></div>
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(255,176,32,0.04),_transparent_60%)]"></div>
    </div>

    <header class="relative flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
      <div class="flex items-center gap-2">
        <Bell class="w-4 h-4 text-amber-300" />
        <h3 class="text-sm font-semibold tracking-wide text-zinc-200">动作提示</h3>
        <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
          {{ prompts.length }}
        </span>
      </div>
      <button
        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
        :disabled="prompts.length === 0"
        @click="store.clearPrompts"
      >
        <Trash2 class="w-3 h-3" />
        清空
      </button>
    </header>

    <div class="flex-1 overflow-y-auto px-4 py-3 space-y-2 scroll-area">
      <div
        v-if="prompts.length === 0"
        class="flex h-full flex-col items-center justify-center gap-2 text-zinc-600"
      >
        <Bell class="w-8 h-8 opacity-40" />
        <p class="text-xs font-mono">暂无提示</p>
      </div>

      <transition-group name="prompt" tag="div" class="space-y-1.5">
        <div
          v-for="p in prompts"
          :key="p.id"
          class="relative flex overflow-hidden rounded-md bg-zinc-900/70 backdrop-blur-sm"
        >
          <!-- 左侧彩色指示条 -->
          <div class="w-1 flex-shrink-0 rounded-l-md" :class="typeMeta[p.type].barBg" />
          <!-- 内容区 -->
          <div class="flex flex-1 items-start gap-2 px-3 py-2 min-w-0">
            <component :is="typeMeta[p.type].icon" class="w-3.5 h-3.5 mt-0.5 flex-shrink-0" :class="typeMeta[p.type].color" />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="text-[10px] font-semibold uppercase tracking-wider" :class="typeMeta[p.type].color">
                  {{ typeMeta[p.type].label }}
                </span>
                <span v-if="p.personIndex !== undefined" class="text-[9px] font-mono px-1 py-px rounded bg-zinc-800 text-zinc-500">
                  P{{ p.personIndex + 1 }}
                </span>
                <span v-if="p.actionName" class="text-[9px] text-zinc-600 font-mono">
                  {{ p.actionName }}
                </span>
                <span class="ml-auto text-[9px] font-mono text-zinc-600">{{ formatTime(p.timestamp) }}</span>
              </div>
              <p class="text-xs text-zinc-300 leading-relaxed">{{ p.message }}</p>
            </div>
          </div>
        </div>
      </transition-group>
    </div>
  </div>
</template>

<style scoped>
.scroll-area::-webkit-scrollbar {
  width: 6px;
}
.scroll-area::-webkit-scrollbar-track {
  background: transparent;
}
.scroll-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}
.prompt-enter-active {
  transition: all 0.35s ease;
}
.prompt-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
</style>
