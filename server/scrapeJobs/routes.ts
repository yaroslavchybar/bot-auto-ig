import { Router } from 'express'
import { scrapeWorkers } from '../shared/store.js'
import {
  getScrapeJobStatus,
  runScrapeJob,
  stopScrapeJobs,
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
  const jobId = String(
    (req.query as any)?.jobId ?? '',
  ).trim()
  res.json(getScrapeJobStatus(jobId || undefined))
})

// ---------------------------------------------------------------------------
// POST /run — validates input, acquires mutex, delegates to runScrapeJob
// ---------------------------------------------------------------------------

router.post('/run', asyncHandler(async (req, res) => {
  const jobId = String(req.body?.jobId ?? '').trim()
  if (!jobId) throw new ValidationError('jobId is required')

  const release = await automationMutex.acquire()
  try {
    validateJobCanStart(jobId)
    await runScrapeJob({ jobId })
    res.json({ success: true, message: 'Scrape job started' })
  } finally {
    release()
  }
}))

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------

router.post('/stop', asyncHandler(async (req, res) => {
  const jobId = String(req.body?.jobId ?? '').trim()

  const release = await automationMutex.acquire()
  try {
    const idsToStop = jobId ? [jobId] : Array.from(scrapeWorkers.keys())
    if (idsToStop.length === 0) throw new ValidationError('No scrape job running')

    const stopped = await stopScrapeJobs(jobId || undefined)
    if (jobId && stopped.length === 0) throw new ValidationError('Scrape job not running')
    res.json({ success: true, stopped })
  } finally {
    release()
  }
}))

/** Pre-flight checks before starting a job. */
function validateJobCanStart(jobId: string): void {
  if (scrapeWorkers.has(jobId)) {
    throw new ValidationError('Scrape job already running')
  }
  const configuredMax = Number(process.env.WORKFLOW_MAX_CONCURRENCY ?? 3)
  const maxConcurrency = Number.isFinite(configuredMax)
    ? Math.max(1, Math.floor(configuredMax))
    : 3
  if (scrapeWorkers.size >= maxConcurrency) {
    throw new AppError(
      `Too many scrape jobs running (max ${maxConcurrency})`,
      429,
      'RATE_LIMITED',
    )
  }
}

export default router
