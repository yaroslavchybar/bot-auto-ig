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
import { killProcess, killByPid, clearPid } from '../shared/ProcessService.js'
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
 * Acquires the automationMutex to prevent race conditions with
 * concurrent start/stop operations.
 */
export function registerShutdownHandlers(deps: ShutdownDeps): void {
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return
    shutdownInProgress = true

    logger.info({ signal }, 'Shutdown signal received, starting graceful shutdown')

    // Acquire mutex to prevent race conditions with in-flight operations
    const release = await automationMutex.acquire()
    try {
      await performShutdown(deps)
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
 * Execute all cleanup steps in order.
 */
async function performShutdown(deps: ShutdownDeps): Promise<void> {
  // 1. Stop accepting new connections
  stopAcceptingConnections(deps.httpServer)

  // 2. Close all WebSocket connections
  closeWebSocketConnections(deps.wss)

  // 3. Persist automation state before killing processes
  persistAutomationState()

  // 4. Kill all Python child processes
  await killAllChildProcesses()

  // 5. Run registered cleanup functions (runner.ts, manual-actions.ts)
  await runRegisteredCleanups()

  // 6. Clear PID files
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
 * Kill all tracked Python child processes:
 * - The main automation process
 * - All workflow worker processes
 * - All profile browser processes
 */
async function killAllChildProcesses(): Promise<void> {
  const killPromises: Promise<void>[] = []

  // Kill main automation process
  if (automationState.process) {
    const pid = automationState.process.pid
    logger.info({ pid }, 'Killing automation process')
    killPromises.push(killProcess(automationState.process))
    automationState.process = null
    automationState.status = 'idle'
  }

  // Kill all workflow worker processes
  for (const [workflowId, worker] of workflowWorkers.entries()) {
    const pid = worker.process.pid
    logger.info({ workflowId, pid }, 'Killing workflow process')
    killPromises.push(killProcess(worker.process))
  }
  workflowWorkers.clear()

  // Kill all profile browser processes
  for (const [profileName, proc] of profileProcesses.entries()) {
    const pid = proc.pid
    logger.info({ profileName, pid }, 'Killing profile process')
    if (pid) {
      killPromises.push(killByPid(pid, proc))
    }
  }
  profileProcesses.clear()

  await Promise.allSettled(killPromises)
  logger.info('All child processes killed')
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
