import { Router } from 'express'
import { localArtifactFile } from './artifacts.js'
import { artifactJson } from './artifact-stream.js'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
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
  AppError,
  ValidationError,
} from '../shared/errors.js'

const router = Router()

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------

router.get('/status', (req, res) => {
  const workflowId = String(
    (req.query as any)?.workflowId ??
'',
  ).trim()
  res.json(getWorkflowStatus(workflowId || undefined))
})

// ---------------------------------------------------------------------------
// GET /artifacts
// ---------------------------------------------------------------------------

router.get('/artifacts', asyncHandler(async (req, res) => {
  const workflowId = String(
    (req.query as any)?.workflowId ??
'',
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


// ---------------------------------------------------------------------------
// GET /artifacts/download
// ---------------------------------------------------------------------------

router.get('/artifacts/download', asyncHandler(async (req, res) => {
  const workflowId = String(req.query.workflowId ?? '').trim()
  const artifactId = String(req.query.artifactId ?? '').trim()
  if (!workflowId || !artifactId) throw new ValidationError('workflowId and artifactId are required')
  const fileName = String(req.query.fileName ?? 'artifact.json').trim() || 'artifact.json'
  const filename = await localArtifactFile(workflowId, artifactId)
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  await pipeline(Readable.from(artifactJson(filename)), res)
}))

// ---------------------------------------------------------------------------
// POST /run — validates input, acquires mutex, delegates to runWorkflow
// ---------------------------------------------------------------------------

router.post('/run', asyncHandler(async (req, res) => {
  const { workflowId, parallelProfiles } = parseRunInput(req.body)

  const release = await automationMutex.acquire()
  try {
    // Re-check state inside mutex to prevent race conditions
    validateWorkflowCanStart(workflowId)
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
    req.body?.workflowId ?? '',
  ).trim()

  const release = await automationMutex.acquire()
  try {
    // Re-check state inside mutex to prevent race conditions
    const idsToStop = workflowId
      ? [workflowId]
      : Array.from(workflowWorkers.keys())
    if (idsToStop.length === 0) {
      throw new ValidationError('No workflow running')
    }

    const stopped = await stopWorkflows(workflowId || undefined)
    if (workflowId && stopped.length === 0) {
      throw new ValidationError('Workflow not running')
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
    body?.workflowId ?? '',
  ).trim()
  if (!workflowId) {
    throw new ValidationError('workflowId is required')
  }
  const parallelProfiles = normalizeOptionalParallelProfiles(
    body?.parallelProfiles,
  )
  return { workflowId, parallelProfiles }
}

/** Pre-flight checks before starting a workflow. */
function validateWorkflowCanStart(workflowId: string): void {
  if (workflowWorkers.has(workflowId)) {
    throw new ValidationError('Workflow already running')
  }
  const configuredMax = Number(process.env.WORKFLOW_MAX_CONCURRENCY ?? 3)
  const maxConcurrency = Number.isFinite(configuredMax)
    ? Math.max(1, Math.floor(configuredMax))
    : 3
  if (workflowWorkers.size >= maxConcurrency) {
    throw new AppError(
      `Too many workflows running (max ${maxConcurrency})`,
      429,
      'RATE_LIMITED',
    )
  }
}

export default router
