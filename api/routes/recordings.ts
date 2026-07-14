// 录制片段保存 API:内存数组存储,用于演示
import { Router } from 'express'

interface Recording {
  id: string
  action: string
  timestamp: number
  durationMs: number
  confidence: number
  savedAt: number
}

const router: Router = Router()
const recordings: Recording[] = []
const MAX_RECORDINGS = 200

router.get('/', (_req, res) => {
  res.json({ total: recordings.length, items: recordings.slice(-50).reverse() })
})

router.post('/', (req, res) => {
  const { action, timestamp, durationMs, confidence } = req.body ?? {}
  if (typeof action !== 'string' || typeof timestamp !== 'number') {
    res.status(400).json({ success: false, error: 'invalid payload' })
    return
  }
  const item: Recording = {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    timestamp,
    durationMs: typeof durationMs === 'number' ? durationMs : 0,
    confidence: typeof confidence === 'number' ? confidence : 0,
    savedAt: Date.now(),
  }
  recordings.push(item)
  if (recordings.length > MAX_RECORDINGS) {
    recordings.splice(0, recordings.length - MAX_RECORDINGS)
  }
  res.status(201).json({ id: item.id, savedAt: item.savedAt })
})

export default router
