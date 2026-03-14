import { Router } from 'express'
import {
  workflowArtifactsGetStorageUrl,
  workflowArtifactsListByWorkflow,
} from '../shared/convexClient.js'
import { workflowWorkers } from '../shared/store.js'
import {
  getWorkflowStatus,
  runWorkflow,
  stopWorkflows,
  normalizeOptionalParallelProfiles,
  automationMutex,
} from './service.js'
import { asyncHandler } from '../shared/asyncHandler.js'
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ExternalServiceError,
} from '../shared/errors.js'

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
    throw new ValidationError('workflowId is required')
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
    throw new ValidationError('storageId is required')
  }
  const url = await workflowArtifactsGetStorageUrl(storageId)
  if (!url) {
    throw new NotFoundError('Artifact URL is not ready')
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
    throw new ValidationError('storageId is required')
  }

  const url = await workflowArtifactsGetStorageUrl(storageId)
  if (!url) {
    throw new NotFoundError('Artifact URL is not ready')
  }

  const upstream = await fetch(url)
  if (!upstream.ok) {
    throw new ExternalServiceError(
      `Failed to download artifact (${upstream.status})`,
    )
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
// POST /run — validates input, acquires mutex, delegates to runWorkflow
// ---------------------------------------------------------------------------

router.post('/run', asyncHandler(async (req, res) => {
  const { workflowId, parallelProfiles } = parseRunInput(req.body)
  validateWorkflowCanStart(workflowId)

  const release = await automationMutex.acquire()
  try {
    await runWorkflow({ workflowId, parallelProfiles })
    res.json({ success: true, message: 'Workflow started' })
  } finally {
    release()
  }
}))

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------

router.post('/stop', asyncHandler(async (req, res) => {
  const workflowId = String(
    req.body?.workflowId ?? req.body?.workflow_id ?? req.body?.id ?? '',
  ).trim()

  const idsToStop = workflowId
    ? [workflowId]
    : Array.from(workflowWorkers.keys())
  if (idsToStop.length === 0) {
    throw new ConflictError('No workflow running')
  }

  const release = await automationMutex.acquire()
  try {
    const stopped = await stopWorkflows(workflowId || undefined)
    if (workflowId && stopped.length === 0) {
      throw new ConflictError('Workflow not running')
    }
    res.json({ success: true, stopped })
  } finally {
    release()
  }
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse and validate the POST /run request body. */
function parseRunInput(body: any): {
  workflowId: string
  parallelProfiles: number | undefined
} {
  const workflowId = String(
    body?.workflowId ?? body?.workflow_id ?? body?.id ?? '',
  ).trim()
  if (!workflowId) {
    throw new ValidationError('workflowId is required')
  }
  const parallelProfiles = normalizeOptionalParallelProfiles(
    body?.parallelProfiles ?? body?.parallel_profiles ?? body?.parallel,
  )
  return { workflowId, parallelProfiles }
}

/** Pre-flight checks before starting a workflow. */
function validateWorkflowCanStart(workflowId: string): void {
  if (workflowWorkers.has(workflowId)) {
    throw new ConflictError('Workflow already running')
  }
  const configuredMax = Number(process.env.WORKFLOW_MAX_CONCURRENCY ?? 3)
  const maxConcurrency = Number.isFinite(configuredMax)
    ? Math.max(1, Math.floor(configuredMax))
    : 3
  if (workflowWorkers.size >= maxConcurrency) {
    throw new ConflictError(
      `Too many workflows running (max ${maxConcurrency})`,
    )
  }
}

export default router
