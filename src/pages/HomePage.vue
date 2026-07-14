<script setup lang="ts">
import { onMounted } from 'vue'
import { useSystemStore } from '@/stores/system'
import PoseCanvas from '@/components/PoseCanvas.vue'
import PromptPanel from '@/components/PromptPanel.vue'
import StatusBar from '@/components/StatusBar.vue'
import ControlPanel from '@/components/ControlPanel.vue'

const store = useSystemStore()

onMounted(() => {
  // 启动时尝试获取后端配置(可选,失败也不影响主功能)
  fetch('/api/health')
    .then((r) => r.json())
    .then((d) => {
      if (d?.ok) console.debug('[system] backend ready')
    })
    .catch(() => {
      console.debug('[system] backend unavailable, running in pure frontend mode')
    })
})
</script>

<template>
  <div class="relative min-h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
    <!-- 背景氛围层 -->
    <div class="fixed inset-0 -z-10">
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(34,227,160,0.08),_transparent_60%)]"></div>
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(255,176,32,0.06),_transparent_60%)]"></div>
      <div class="absolute inset-0 grid-overlay"></div>
    </div>

    <!-- 顶部导航 -->
    <header class="border-b border-zinc-800/60 backdrop-blur">
      <div class="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
        <div class="flex items-center gap-3">
          <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/15 ring-1 ring-emerald-400/30">
            <span class="font-mono text-emerald-300 font-bold">M</span>
          </div>
          <div>
            <h1 class="text-lg font-semibold tracking-tight">
              <span class="text-zinc-100">MOYHUAI</span>
              <span class="ml-2 text-emerald-300/80 text-sm font-mono">v0.1</span>
            </h1>
            <p class="text-[11px] text-zinc-500 font-mono tracking-wider uppercase">Visual Capture System</p>
          </div>
        </div>
        <nav class="hidden md:flex items-center gap-6 text-xs font-mono uppercase tracking-widest text-zinc-500">
          <span class="text-emerald-300">· Live</span>
        </nav>
      </div>
    </header>

    <!-- 主体布局 -->
    <main class="mx-auto max-w-[1600px] px-6 pb-0 pt-6">
      <!-- 状态栏 -->
      <StatusBar class="mb-6" />

      <!-- 主内容三栏 -->
      <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
        <!-- 左侧:摄像头视图 -->
        <section class="relative">
          <div class="aspect-video w-full">
            <PoseCanvas />
          </div>
          <div class="mt-3 flex items-center justify-between text-[11px] font-mono text-zinc-600">
            <span>1920×1080 · 30 FPS TARGET</span>
            <span>BUFFER: {{ store.latency > 0 ? `${store.latency.toFixed(1)}ms` : '—' }}</span>
          </div>
        </section>

        <!-- 右侧:控制 + 提示 -->
        <aside class="flex flex-col gap-4 lg:h-[calc(100vh-220px)]">
          <ControlPanel />
          <div class="h-[220px]">
            <PromptPanel />
          </div>
        </aside>
      </div>
    </main>

    <footer class="border-t border-zinc-800/60 px-6 py-0.5 text-center text-[11px] font-mono text-zinc-600">
      视频帧仅在浏览器本地处理,不上传服务器 · Powered by MediaPipe Tasks Vision
    </footer>
  </div>
</template>

<style scoped>
.grid-overlay {
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.015) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.015) 1px, transparent 1px);
  background-size: 48px 48px;
}
</style>
