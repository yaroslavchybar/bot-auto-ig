/**
 * Graceful Shutdown Handler
 *
 * On SIGTERM/SIGINT:
 * 1. Stop accepting new HTTP connections (close the server)
 * 2. Close all WebSocket connections
 * 3. Kill all Python child processes (automation, workflows, profiles)
 * 4. Persist automation state atomically
 * 5. Clear PID files
 * 6. Exit cleanly with code 0
 *
 * Also provides registerCleanup() for modules that need custom teardown.
 */
import type { Server } from 'http'
import type { WebSocketServer } from 'ws'
import { automationState, workflowWorkers, profileProcesses, clients } from '../shared/store.js'
import { automationMutex } from '../shared/mutex.js'
import { killProcess, clearPid, getTrackedProcesses, getPid } from '../shared/ProcessService.js'
import { saveState } from './state.js'
import logger from '../shared/logger.js'

// ---------------------------------------------------------------------------
// Legacy registerCleanup API (used by runner.ts, manual-actions.ts)
// ---------------------------------------------------------------------------

type CleanupFn = () => void | Promise<void>
const cleanupFns = new Set<CleanupFn>()

/** Register a cleanup function to run during graceful shutdown. */
export function registerCleanup(fn: CleanupFn): () => void {
  cleanupFns.add(fn)
  return () => { cleanupFns.delete(fn) }
}

// ---------------------------------------------------------------------------
// Shutdown orchestration
// ---------------------------------------------------------------------------

interface ShutdownDeps {
  httpServer: Server
  wss: WebSocketServer
}

let shutdownInProgress = false

/**
 * Register SIGTERM and SIGINT handlers for graceful shutdown.
 *
 * Closes HTTP and WebSocket listeners FIRST (so no new requests arrive),
 * then acquires automationMutex for cleanup of in-flight operations.
 */
export function registerShutdownHandlers(deps: ShutdownDeps): void {
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return
    shutdownInProgress = true

    logger.info({ signal }, 'Shutdown signal received, starting graceful shutdown')

    // 1. Stop accepting new connections BEFORE acquiring the mutex.
    //    This prevents new requests from arriving while we wait for
    //    the mutex (which may be held by an in-flight start/stop op).
    stopAcceptingConnections(deps.httpServer)
    closeWebSocketConnections(deps.wss)

    // 2. Acquire mutex to prevent race conditions with in-flight operations
    const release = await automationMutex.acquire()
    try {
      await performCleanup()
    } finally {
      release()
    }

    logger.info('Graceful shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

/**
 * Execute cleanup steps that run INSIDE the mutex.
 * Listeners are already closed before the mutex is acquired.
 */
async function performCleanup(): Promise<void> {
  // 1. Persist automation state before killing processes
  persistAutomationState()

  // 2. Kill all Python child processes
  await killAllChildProcesses()

  // 3. Run registered cleanup functions (runner.ts, manual-actions.ts)
  await runRegisteredCleanups()

  // 4. Clear PID files
  clearPid()
}

/** Stop the HTTP server from accepting new connections. */
function stopAcceptingConnections(httpServer: Server): void {
  httpServer.close((err) => {
    if (err) {
      logger.error({ err }, 'Error closing HTTP server')
    }
  })
  logger.info('Stopped accepting new connections')
}

/** Close all connected WebSocket clients and the WSS server. */
function closeWebSocketConnections(wss: WebSocketServer): void {
  let closed = 0
  for (const client of clients) {
    try {
      client.close(1001, 'Server shutting down')
      closed++
    } catch {
      // Client may already be disconnected
    }
  }
  clients.clear()

  wss.close((err) => {
    if (err) {
      logger.error({ err }, 'Error closing WebSocket server')
    }
  })
  logger.info({ count: closed }, 'Closed WebSocket connections')
}

/** Persist automation state atomically before process exit. */
function persistAutomationState(): void {
  try {
    const pid = automationState.process?.pid ?? null
    saveState({
      status: automationState.status,
      pid,
      startedAt: automationState.status === 'running' ? new Date().toISOString() : null,
      settings: null,
    })
    logger.info('Persisted automation state to file')
  } catch (err) {
    logger.error({ err }, 'Failed to persist automation state during shutdown')
  }
}

/**
 * Kill ALL tracked Python child processes via the global ProcessService
 * registry. This catches automation, workflow, profile, login, and
 * fingerprint subprocesses — nothing is orphaned.
 */
async function killAllChildProcesses(): Promise<void> {
  // Clear known state maps so the application doesn't reference dead procs
  automationState.process = null
  automationState.status = 'idle'
  workflowWorkers.clear()
  profileProcesses.clear()

  // Kill every child tracked in the global registry
  const tracked = getTrackedProcesses()
  const killPromises: Promise<void>[] = []

  for (const proc of tracked) {
    const pid = getPid(proc)
    logger.info({ pid }, 'Killing tracked child process')
    killPromises.push(killProcess(proc))
  }

  await Promise.allSettled(killPromises)
  logger.info({ count: tracked.size }, 'All child processes killed')
}

/** Run all cleanup functions registered via registerCleanup(). */
async function runRegisteredCleanups(): Promise<void> {
  for (const fn of cleanupFns) {
    try {
      await fn()
    } catch (err) {
      logger.error({ err }, 'Cleanup function failed')
    }
  }
}
