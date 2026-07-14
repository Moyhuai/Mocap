/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import configRoutes from './routes/config.js'
import recordingsRoutes from './routes/recordings.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/config', configRoutes)
app.use('/api/recordings', recordingsRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      ok: true,
      success: true,
      message: 'ok',
      ts: Date.now(),
    })
  },
)

/**
 * 静态文件托管:生产环境下提供 dist 目录
 */
const distPath = path.resolve(__dirname, '../dist')
app.use(express.static(distPath))

/**
 * SPA 回退:非 /api 路径返回 index.html
 */
app.get(/^(?!\/api).*/, (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET') return next()
  res.sendFile(path.join(distPath, 'index.html'))
})

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
