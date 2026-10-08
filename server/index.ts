/** Private Bun worker for browser control; the public API runs in Rust/Axum. */
import './env.js'
// SDK/browser exceptions still reach Sentry from the worker.
import './shared/sentry.js'

import { captureConsole } from './logs/console.js'
import { registerShutdownHandlers } from './automation/shutdown.js'
import { pruneOldCloakBrowsers } from './browser/cloakCache.js'
import { backfillLocalCloakSeeds } from './browser/seedBackfill.js'
import logger, { logOperation, addLogContext, redactLogValues } from './shared/logger.js'
import { automationsReconcileInterrupted } from './shared/convexClient.js'
import { startRuntime, stopRuntime, runtimeRequest } from './shared/runtime.js'
import { Commands } from './worker/commands.js'

import { cancelBrowserLogin, runBrowserLogin, shutdownBrowserLogins } from './ig-accounts/login.js'
import { ValidationError } from './shared/errors.js'

import { createWorkerServer } from './worker/server.js'

captureConsole()
const callbacks = new Commands()
callbacks.register('browser.shutdown', 'POST', '/', async (_req, res) => {
  await shutdownBrowserLogins()
  res.json({ stopped: true })
})
callbacks.register('browser.login', 'POST', '/', async (req, res) => {
  const { attemptId, profileName, proxy, account } = req.body ?? {}
  if (
    typeof attemptId !== 'string' ||
    !/^[\da-f-]{36}$/.test(attemptId) ||
    typeof profileName !== 'string' ||
    typeof proxy !== 'string' ||
    typeof account?.username !== 'string' ||
    typeof account?.password !== 'string' ||
    typeof account?.authenticatorKey !== 'string'
  )
    throw new ValidationError('Invalid browser login')
  redactLogValues(account.password, account.authenticatorKey, proxy)
  const disconnected = () => {
    void cancelBrowserLogin(attemptId).catch(() => undefined)
  }
  const action = runBrowserLogin(attemptId, profileName, proxy, account)
  res.once('close', disconnected)
  try {
    res.json(await action)
  } finally {
    res.off('close', disconnected)
  }
})
callbacks.register('browser.cancel-login', 'POST', '/', async (req, res) => {
  const { attemptId } = req.body ?? {}
  if (typeof attemptId !== 'string' || !/^[\da-f-]{36}$/.test(attemptId))
    throw new ValidationError('Invalid browser login attempt')
  await cancelBrowserLogin(attemptId)
  res.json({ cancelled: true })
})
const server = createWorkerServer([callbacks])
const PORT = process.env.WORKER_PORT || 3005

const STARTUP_RETRY_ATTEMPTS = 10
const STARTUP_RETRY_DELAY_MS = 3000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Retry a startup step while Convex dev is still deploying. Throws on final failure. */
async function retryStartup<T>(step: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= STARTUP_RETRY_ATTEMPTS; attempt++) {
    try {
      return await step()
    } catch (err) {
      lastError = err
      if (attempt === STARTUP_RETRY_ATTEMPTS) break
      logger.info({ event: 'startup.retry', attempt, step: label, error: err })
      await sleep(STARTUP_RETRY_DELAY_MS)
    }
  }
  throw lastError
}

async function startServer(): Promise<void> {
  return logOperation('server.startup', { port: PORT }, async () => {
    // Register graceful shutdown handlers (SIGTERM/SIGINT)
    registerShutdownHandlers({ httpServer: server })

    await startRuntime()
    const prunedBinaries = pruneOldCloakBrowsers()
    addLogContext({ prunedBinaryCount: prunedBinaries.length })
    if (prunedBinaries.length > 0) {
      logger.info({
        event: 'index.pruned_superseded_cloak_browser_binaries',
        pruned: prunedBinaries,
        message: 'Pruned superseded Cloak browser binaries',
      })
    }
    await retryStartup(
      () => runtimeRequest('/profiles/maintenance', { method: 'POST', body: '{}' }),
      'profile maintenance',
    )

    // Convex dev deploys alongside the server, so the reconcile endpoint
    // may 404 until the new functions are live. Retry instead of crashing.
    await retryStartup(() => automationsReconcileInterrupted(), 'automation reconcile')

    await retryStartup(backfillLocalCloakSeeds, 'Cloak fingerprint seed backfill')
    logger.info({
      event: 'index.cloak_fingerprint_seed_backfill_complete',
      message: 'Cloak fingerprint seed backfill complete',
    })

    // Reset stale profile runtime flags left behind by unexpected restarts.
    const reconciled = await runtimeRequest<{ cleared: number; errors: string[] }>(
      '/profiles/reconcile',
      { method: 'POST', body: '{}' },
    )
    addLogContext({
      reconciledProfileCount: reconciled.cleared,
      reconciliationErrorCount: reconciled.errors.length,
    })
    if (reconciled.cleared > 0) {
      logger.info({
        event: 'index.cleared_stale_running_status_for',
        cleared: reconciled.cleared,
        message: 'Cleared stale running status for profile(s)',
      })
    }
    if (reconciled.errors.length > 0) {
      for (const err of reconciled.errors) {
        logger.error({
          event: 'index.reconciliation_error',
          error: err,
          message: 'Reconciliation error',
          outcome: 'error',
        })
      }
    }

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(Number(PORT), '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
        addLogContext({ listening: true })
      })
    })
    await runtimeRequest('/coordination/start', { method: 'POST', body: '{}' })
  })
}

startServer().catch(async () => {
  // Startup emits its completion event before rejecting.
  await stopRuntime()
  process.exit(1)
})
