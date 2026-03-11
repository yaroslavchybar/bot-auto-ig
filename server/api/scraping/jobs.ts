import { Router } from 'express'
import {
  scrapingTasksCancel,
  scrapingTasksCreate,
  scrapingTasksGetById,
  scrapingTasksGetManifestUrl,
  scrapingTasksGetStorageUrl,
  scrapingTasksPause,
  scrapingTasksResume,
  scrapingTasksStart,
} from '../../data/convex.js'
import { broadcast } from '../../websocket.js'

function parseTargets(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw
          .split(/\r?\n/)
          .flatMap((line) => line.split(','))
      : []

  const seen = new Set<string>()
  const targets: string[] = []
  for (const value of values) {
    const cleaned = String(value ?? '').trim().replace(/^@+/, '')
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    targets.push(cleaned)
  }
  return targets
}

const router = Router()

function emitJobLog(
  level: 'info' | 'warn' | 'error' | 'success',
  message: string,
  meta: {
    taskId?: string
    profileName?: string
    targetUsername?: string
    errorCode?: string
    attempt?: number
  } = {},
) {
  broadcast({
    type: 'log',
    source: 'scraping-task',
    level,
    message,
    ...(meta.taskId ? { taskId: meta.taskId } : {}),
    ...(meta.profileName ? { profileName: meta.profileName } : {}),
    ...(meta.targetUsername ? { targetUsername: meta.targetUsername } : {}),
    ...(meta.errorCode ? { errorCode: meta.errorCode } : {}),
    ...(typeof meta.attempt === 'number' ? { attempt: meta.attempt } : {}),
  })
}

router.post('/', async (req, res) => {
  try {
    const targets = parseTargets(req.body?.targets ?? req.body?.targetUsername ?? req.body?.target_username)
    if (targets.length === 0) {
      return res.status(400).json({ error: 'targets are required' })
    }

    const name = String(req.body?.name || '').trim() || `${targets[0]} ${req.body?.kind === 'following' ? 'following' : 'followers'}`
    const task = await scrapingTasksCreate({
      name,
      kind: req.body?.kind === 'following' ? 'following' : 'followers',
      targets,
      maxAttempts: req.body?.maxAttempts,
    })
    emitJobLog('info', `Created scraping task "${name}" with ${targets.length} target(s)`, {
      taskId: String(task?._id || ''),
      targetUsername: targets[0],
    })
    return res.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return res.status(400).json({ error: message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const task = await scrapingTasksGetById(String(req.params.id || ''))
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }
    return res.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return res.status(400).json({ error: message })
  }
})

router.post('/:id/start', async (req, res) => {
  try {
    const task = await scrapingTasksStart(String(req.params.id || ''))
    emitJobLog('info', `Queued scraping task "${task?.name || req.params.id}"`, {
      taskId: String(task?._id || req.params.id || ''),
      targetUsername: Array.isArray(task?.targets) ? task.targets[0] : undefined,
    })
    return res.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return res.status(400).json({ error: message })
  }
})

router.post('/:id/pause', async (req, res) => {
  try {
    const task = await scrapingTasksPause(String(req.params.id || ''))
    emitJobLog('warn', `Paused scraping task "${task?.name || req.params.id}"`, {
      taskId: String(task?._id || req.params.id || ''),
    })
    return res.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return res.status(400).json({ error: message })
  }
})

router.post('/:id/resume', async (req, res) => {
  try {
    const task = await scrapingTasksResume(String(req.params.id || ''))
    emitJobLog('info', `Resumed scraping task "${task?.name || req.params.id}"`, {
      taskId: String(task?._id || req.params.id || ''),
      targetUsername: Array.isArray(task?.targets) ? task.targets[0] : undefined,
    })
    return res.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return res.status(400).json({ error: message })
  }
})

router.post('/:id/cancel', async (req, res) => {
  try {
    const task = await scrapingTasksCancel(String(req.params.id || ''))
    emitJobLog('warn', `Cancelled scraping task "${task?.name || req.params.id}"`, {
      taskId: String(task?._id || req.params.id || ''),
    })
    return res.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return res.status(400).json({ error: message })
  }
})

router.get('/:id/export', async (req, res) => {
  try {
    const taskId = String(req.params.id || '').trim()
    if (!taskId) {
      return res.status(400).json({ error: 'Task id is required' })
    }

    const manifestUrl = await scrapingTasksGetManifestUrl(taskId)
    if (manifestUrl) {
      return res.json({ url: manifestUrl, type: 'manifest' })
    }

    const task = await scrapingTasksGetById(taskId)
    const storageId = typeof task?.storageId === 'string' ? task.storageId : null
    if (!storageId) {
      return res.status(404).json({ error: 'Task export is not ready' })
    }

    const storageUrl = await scrapingTasksGetStorageUrl(storageId)
    if (!storageUrl) {
      return res.status(404).json({ error: 'Task export is not ready' })
    }

    return res.json({ url: storageUrl, type: 'storage' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return res.status(400).json({ error: message })
  }
})

export default router
