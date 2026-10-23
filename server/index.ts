/** Private Bun worker for browser control; the public API runs in Rust/Axum. */
import './env.js'
// SDK/browser exceptions still reach Sentry from the worker.
import './shared/sentry.js'

import { captureConsole } from './logs/console.js'
import { registerShutdownHandlers } from './automation/shutdown.js'
import { pruneOldCloakBrowsers } from './browser/cloakCache.js'
import logger, { logOperation, addLogContext, redactLogValues } from './shared/logger.js'
import { automationsReconcileInterrupted } from './shared/convexClient.js'
import { startRuntime, stopRuntime, runtimeRequest } from './shared/runtime.js'
import type { Commands } from './worker/commands.js'

import { cancelBrowserLogin, runBrowserLogin, shutdownBrowserLogins } from './ig-accounts/login.js'
import { ValidationError } from './shared/errors.js'

import { createWorkerServer } from './worker/server.js'
import { interestCommands } from './automation/interests.js'

captureConsole()
const callbacks: Commands = {
  ...interestCommands(),
  'browser.shutdown': async () => {
    await shutdownBrowserLogins()
    return { stopped: true }
  },
  'browser.login': async ({ body, signal }) => {
    if (!body || typeof body !== 'object') throw new ValidationError('Invalid browser login')
    const { attemptId, profileName, proxy, account } = body as Record<string, unknown>
    if (
      typeof attemptId !== 'string' ||
      !/^[\da-f-]{36}$/.test(attemptId) ||
      typeof profileName !== 'string' ||
      typeof proxy !== 'string' ||
      !account ||
      typeof account !== 'object' ||
      !('username' in account) ||
      typeof account.username !== 'string' ||
      !('password' in account) ||
      typeof account.password !== 'string' ||
      !('authenticatorKey' in account) ||
      typeof account.authenticatorKey !== 'string'
    )
      throw new ValidationError('Invalid browser login')
    redactLogValues(account.password, account.authenticatorKey, proxy)
    const disconnected = () => {
      void cancelBrowserLogin(attemptId).catch(() => undefined)
    }
    signal.throwIfAborted()
    const action = runBrowserLogin(attemptId, profileName, proxy, {
      username: account.username,
      password: account.password,
      authenticatorKey: account.authenticatorKey,
    })
    signal.addEventListener('abort', disconnected, { once: true })
    try {
      return await action
    } finally {
      signal.removeEventListener('abort', disconnected)
    }
  },
  'browser.cancel-login': async ({ body }) => {
    const attemptId =
      body && typeof body === 'object' && 'attemptId' in body ? body.attemptId : undefined
    if (typeof attemptId !== 'string' || !/^[\da-f-]{36}$/.test(attemptId))
      throw new ValidationError('Invalid browser login attempt')
    await cancelBrowserLogin(attemptId)
    return { cancelled: true }
  },
}
const server = createWorkerServer(callbacks)
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
