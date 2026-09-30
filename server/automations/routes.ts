import { Commands } from '../worker/commands.js'
import { automationWorkers } from '../shared/store.js'
import {
  getAutomationStatus,
  runAutomation,
  stopAutomations,
  normalizeOptionalParallelProfiles,
  automationMutex,
} from './service.js'
import { AppError, ValidationError } from '../shared/errors.js'

const commands = new Commands()

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------

commands.register(
  'automations.get.status',
  'GET',
  '/status',
  (req, res) => {
    const automationId = String((req.query as any)?.automationId ?? '').trim()
    res.json(getAutomationStatus(automationId || undefined))
  },
  'json',
)

// ---------------------------------------------------------------------------
// POST /run — validates input, acquires mutex, delegates to runAutomation
// ---------------------------------------------------------------------------

commands.register(
  'automations.post.run',
  'POST',
  '/run',
  async (req, res) => {
    const { automationId, parallelProfiles } = parseRunInput(req.body)

    const release = await automationMutex.acquire()
    try {
      // Re-check state inside mutex to prevent race conditions
      validateAutomationCanStart(automationId)
      await runAutomation({ automationId, parallelProfiles })
      res.json({ success: true, message: 'Automation started' })
    } finally {
      release()
    }
  },
  'json',
)

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------

commands.register(
  'automations.post.stop',
  'POST',
  '/stop',
  async (req, res) => {
    const automationId = String(req.body?.automationId ?? '').trim()

    const release = await automationMutex.acquire()
    try {
      // Re-check state inside mutex to prevent race conditions
      const idsToStop = automationId ? [automationId] : Array.from(automationWorkers.keys())
      if (idsToStop.length === 0) {
        throw new ValidationError('No automation running')
      }

      const stopped = await stopAutomations(automationId || undefined)
      if (automationId && stopped.length === 0) {
        throw new ValidationError('Automation not running')
      }
      res.json({ success: true, stopped })
    } finally {
      release()
    }
  },
  'json',
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse and validate the POST /run request body. */
function parseRunInput(body: any): {
  automationId: string
  parallelProfiles: number | undefined
} {
  const automationId = String(body?.automationId ?? '').trim()
  if (!automationId) {
    throw new ValidationError('automationId is required')
  }
  const parallelProfiles = normalizeOptionalParallelProfiles(body?.parallelProfiles)
  return { automationId, parallelProfiles }
}

/** Pre-flight checks before starting an automation. */
function validateAutomationCanStart(automationId: string): void {
  if (automationWorkers.has(automationId)) {
    throw new ValidationError('Automation already running')
  }
  const configuredMax = Number(process.env.AUTOMATION_MAX_CONCURRENCY ?? 3)
  const maxConcurrency = Number.isFinite(configuredMax) ? Math.max(1, Math.floor(configuredMax)) : 3
  if (automationWorkers.size >= maxConcurrency) {
    throw new AppError(`Too many automations running (max ${maxConcurrency})`, 429, 'RATE_LIMITED')
  }
}

export default commands
