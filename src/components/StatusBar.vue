<script setup lang="ts">
import { computed } from 'vue'
import { useSystemStore } from '@/stores/system'
import { Cpu, Activity, Users } from 'lucide-vue-next'

const store = useSystemStore()

const statusText = computed(() => {
  switch (store.status) {
    case 'idle':
      return '空闲'
    case 'loading':
      return '加载中'
    case 'running':
      return '运行中'
    case 'error':
      return '错误'
  }
})

const statusColor = computed(() => {
  switch (store.status) {
    case 'running':
      return 'text-emerald-300'
    case 'loading':
      return 'text-amber-300'
    case 'error':
      return 'text-rose-300'
    default:
      return 'text-zinc-400'
  }
})

const latencyColor = computed(() => {
  if (store.latency < 5) return 'text-emerald-300'
  if (store.latency < 15) return 'text-amber-300'
  return 'text-rose-300'
})
</script>

<template>
  <div class="grid grid-cols-2 gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 backdrop-blur md:grid-cols-5">
    <!-- 状态 -->
    <div class="flex items-center gap-2">
      <Activity class="w-4 h-4 text-zinc-500" />
      <div>
        <div class="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">Status</div>
        <div class="text-sm font-mono" :class="statusColor">
          <span class="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
            :class="{
              'bg-emerald-400 animate-pulse': store.status === 'running',
              'bg-amber-400 animate-pulse': store.status === 'loading',
              'bg-rose-400': store.status === 'error',
              'bg-zinc-600': store.status === 'idle',
            }"
          />
          {{ statusText }}
        </div>
      </div>
    </div>

    <!-- 延迟 -->
    <div class="flex items-center gap-2">
      <Cpu class="w-4 h-4 text-zinc-500" />
      <div>
        <div class="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">Latency</div>
        <div class="text-sm font-mono" :class="latencyColor">
          {{ store.latency.toFixed(1) }}
          <span class="text-[10px] text-zinc-600">ms</span>
        </div>
      </div>
    </div>

    <!-- 人数 -->
    <div class="flex items-center gap-2">
      <Users class="w-4 h-4 text-zinc-500" />
      <div>
        <div class="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">Persons</div>
        <div class="text-sm font-mono text-zinc-200">
          {{ store.personCount }}
          <span class="text-[10px] text-zinc-600">/4</span>
        </div>
      </div>
    </div>

  </div>
</template>
