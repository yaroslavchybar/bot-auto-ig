/** Private Bun worker for browser control; the public API runs in Rust/Axum. */
import './env.js'
// SDK/browser exceptions still reach Sentry from the worker.
import './shared/sentry.js'

import { initWebSocket } from './websocket.js'

import { captureConsole } from './logs/console.js'
import { profilesRouter } from './profiles/index.js'
import { automationsRouter } from './automations/index.js'
import displaysRouter from './displays/routes.js'
import chatRouter from './chat/routes.js'
import igAccountsRouter from './ig-accounts/routes.js'
import { startIgAccountWorker } from './ig-accounts/login.js'
import { startModelWarmupWorker } from './ig-accounts/warmup.js'
import { startChatWorker } from './chat/worker.js'
import { registerShutdownHandlers } from './automation/shutdown.js'
import { profileManager } from './profiles/index.js'
import { pruneOldCloakBrowsers } from './browser/cloakCache.js'
import { backfillLocalCloakSeeds } from './browser/seedBackfill.js'
import { retryProfileMaintenance, startProfileMaintenance } from './profiles/maintenance.js'
import { getActiveRuntimeProfileNames } from './shared/store.js'
import logger, { logOperation, addLogContext } from './shared/logger.js'
import { automationsReconcileInterrupted } from './shared/convexClient.js'
import { cleanupOrphanedProcesses } from './shared/ProcessService.js'
import { startScraperWorker } from './scraper/worker.js'
import { startRuntime } from './shared/runtime.js'

import { createWorkerServer } from './worker/server.js'

captureConsole()
const server = createWorkerServer([
  profilesRouter,
  automationsRouter,
  displaysRouter,
  chatRouter,
  igAccountsRouter,
])
const wss = initWebSocket(server)
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
    registerShutdownHandlers({ httpServer: server, wss })

    // Kill stale automation processes left behind by a crash. Detached
    // children survive restarts, so reconcile them before touching flags.
    await cleanupOrphanedProcesses()
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
    await retryProfileMaintenance()
    server.once('close', startProfileMaintenance())

    // Convex dev deploys alongside the server, so the reconcile endpoint
    // may 404 until the new functions are live. Retry instead of crashing.
    await retryStartup(() => automationsReconcileInterrupted(), 'automation reconcile')

    await retryStartup(backfillLocalCloakSeeds, 'Cloak fingerprint seed backfill')
    logger.info({
      event: 'index.cloak_fingerprint_seed_backfill_complete',
      message: 'Cloak fingerprint seed backfill complete',
    })

    // Reset stale profile runtime flags left behind by unexpected restarts.
    const reconciled = await profileManager.reconcileRuntimeStatuses(getActiveRuntimeProfileNames())
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
        startIgAccountWorker()
        startModelWarmupWorker()
        const stopRoutineScheduler = startRoutineScheduler()
        server.once('close', stopRoutineScheduler)
        const stopScraperWorker = startScraperWorker()
        server.once('close', stopScraperWorker)
        server.once('close', startChatWorker())
        addLogContext({ listening: true, websocketEnabled: true })
      })
    })
  })
}

startServer().catch(() => {
  // Startup emits its completion event before rejecting.
  process.exit(1)
})
import { startRoutineScheduler } from './automations/scheduler.js'
