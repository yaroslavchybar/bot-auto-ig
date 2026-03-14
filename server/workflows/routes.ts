import { Router } from 'express'
import {
  workflowArtifactsGetStorageUrl,
  workflowArtifactsListByWorkflow,
} from '../data/convex.js'
import { workflowWorkers } from '../store.js'
import {
  getWorkflowStatus,
  runWorkflow,
  stopWorkflows,
  normalizeOptionalParallelProfiles,
  automationMutex,
} from './service.js'
import { asyncHandler } from '../shared/asyncHandler.js'
import logger from '../shared/logger.js'

const router = Router()

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------

router.get('/status', (req, res) => {
  const workflowId = String(
    (req.query as any)?.workflowId ??
    (req.query as any)?.workflow_id ??
    (req.query as any)?.id ?? '',
  ).trim()
  res.json(getWorkflowStatus(workflowId || undefined))
})

// ---------------------------------------------------------------------------
// GET /artifacts
// ---------------------------------------------------------------------------

router.get('/artifacts', asyncHandler(async (req, res) => {
  const workflowId = String(
    (req.query as any)?.workflowId ??
    (req.query as any)?.workflow_id ??
    (req.query as any)?.id ?? '',
  ).trim()
  if (!workflowId) {
    return res.status(400).json({ error: 'workflowId is required' })
  }
  const artifacts = await workflowArtifactsListByWorkflow(workflowId)
  res.json(artifacts)
}))

// ---------------------------------------------------------------------------
// GET /artifacts/storage-url
// ---------------------------------------------------------------------------

router.get('/artifacts/storage-url', asyncHandler(async (req, res) => {
  const storageId = String((req.query as any)?.storageId ?? '').trim()
  if (!storageId) {
    return res.status(400).json({ error: 'storageId is required' })
  }
  const url = await workflowArtifactsGetStorageUrl(storageId)
  if (!url) {
    return res.status(404).json({ error: 'Artifact URL is not ready' })
  }
  res.json({ url })
}))

// ---------------------------------------------------------------------------
// GET /artifacts/download
// ---------------------------------------------------------------------------

router.get('/artifacts/download', asyncHandler(async (req, res) => {
  const storageId = String((req.query as any)?.storageId ?? '').trim()
  const fileName = String(
    (req.query as any)?.fileName ?? 'artifact.json',
  ).trim() || 'artifact.json'
  if (!storageId) {
    return res.status(400).json({ error: 'storageId is required' })
  }

  const url = await workflowArtifactsGetStorageUrl(storageId)
  if (!url) {
    return res.status(404).json({ error: 'Artifact URL is not ready' })
  }

  const upstream = await fetch(url)
  if (!upstream.ok) {
    return res
      .status(502)
      .json({ error: `Failed to download artifact (${upstream.status})` })
  }

  const contentType =
    upstream.headers.get('content-type') || 'application/octet-stream'
  const arrayBuffer = await upstream.arrayBuffer()
  res.setHeader('Content-Type', contentType)
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  )
  res.send(Buffer.from(arrayBuffer))
}))

// ---------------------------------------------------------------------------
// POST /run
// ---------------------------------------------------------------------------

router.post('/run', asyncHandler(async (req, res) => {
  const release = await automationMutex.acquire()
  try {
    const workflowId = String(
      req.body?.workflowId ?? req.body?.workflow_id ?? req.body?.id ?? '',
    ).trim()
    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId is required' })
    }

    if (workflowWorkers.has(workflowId)) {
      return res.status(400).json({ error: 'Workflow already running' })
    }

    const configuredMax = Number(process.env.WORKFLOW_MAX_CONCURRENCY ?? 3)
    const maxConcurrency = Number.isFinite(configuredMax)
      ? Math.max(1, Math.floor(configuredMax))
      : 3
    if (workflowWorkers.size >= maxConcurrency) {
      return res
        .status(429)
        .json({ error: `Too many workflows running (max ${maxConcurrency})` })
    }

    const parallelProfiles = normalizeOptionalParallelProfiles(
      req.body?.parallelProfiles ??
      req.body?.parallel_profiles ??
      req.body?.parallel,
    )

    await runWorkflow({ workflowId, parallelProfiles })
    res.json({ success: true, message: 'Workflow started' })
  } catch (error: any) {
    const statusCode = error?.statusCode || 500
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(statusCode).json({ error: message })
  } finally {
    release()
  }
}))

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------

router.post('/stop', asyncHandler(async (req, res) => {
  const release = await automationMutex.acquire()
  try {
    const workflowId = String(
      req.body?.workflowId ?? req.body?.workflow_id ?? req.body?.id ?? '',
    ).trim()

    const idsToStop = workflowId
      ? [workflowId]
      : Array.from(workflowWorkers.keys())
    if (idsToStop.length === 0) {
      return res.status(400).json({ error: 'No workflow running' })
    }

    const stopped = await stopWorkflows(workflowId || undefined)
    if (workflowId && stopped.length === 0) {
      return res.status(400).json({ error: 'Workflow not running' })
    }
    res.json({ success: true, stopped })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: message })
  } finally {
    release()
  }
}))

export default router
