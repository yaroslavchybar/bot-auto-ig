/**
 * Graceful Shutdown Handler
 *
 * On SIGTERM/SIGINT:
 * 1. Stop accepting new HTTP connections (close the server)
 * 2. Close all WebSocket connections
 * 3. Kill all Bun child processes (automation, automations, profiles)
 * 4. Persist automation state atomically
 * 5. Clear PID files
 * 6. Exit cleanly with code 0
 */
import type { Server } from 'http'
import type { WebSocketServer } from 'ws'
import { automationWorkers, profileProcesses, clients } from '../shared/store.js'
import { automationMutex } from '../shared/mutex.js'
import { killProcess, requestChildStop, getTrackedProcesses, getPid, clearRegistry } from '../shared/ProcessService.js'
import logger, { logOperation, addLogContext } from '../shared/logger.js'

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

    await logOperation('server.shutdown', { signal, trackedProcessCount: getTrackedProcesses().size }, async () => {

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

    })
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
  // 2. Kill all Bun child processes
  await killAllChildProcesses()

}

/** Stop the HTTP server from accepting new connections. */
function stopAcceptingConnections(httpServer: Server): void {
  httpServer.close((err) => {
    if (err) {
      logger.error({ event: 'automation.shutdown.closing_http_server', error: err, message: 'Error closing HTTP server', outcome: 'error' })
    }
  })
  addLogContext({ acceptingConnections: false })
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
      logger.error({ event: 'automation.shutdown.closing_websocket_server', error: err, message: 'Error closing WebSocket server', outcome: 'error' })
    }
  })
  addLogContext({ closedSocketCount: closed })
}

/**
 * Kill ALL tracked Bun child processes via the global ProcessService
 * registry. This catches automation, automation, profile, login, and
 * manual browser subprocesses — nothing is orphaned.
 */
async function killAllChildProcesses(): Promise<void> {
  // Clear known state maps so the application doesn't reference dead procs
  automationWorkers.clear()
  profileProcesses.clear()

  // Ask each child to stop cleanly first (stdin `stop` closes browsers and
  // frees license seats); force-kill only the ones that stay alive.
  const tracked = getTrackedProcesses()
  const killPromises: Promise<void>[] = []

  for (const proc of tracked) {
    const pid = getPid(proc)
    logger.info({ event: 'automation.shutdown.stopping_tracked_child_process', pid, message: 'Stopping tracked child process' })
    killPromises.push(
      (async () => {
        if (await requestChildStop(proc, 10_000)) return
        await killProcess(proc)
      })(),
    )
  }

  const results = await Promise.allSettled(killPromises)
  const failures = results.filter(result => result.status === 'rejected')
  addLogContext({ stoppedProcessCount: results.length - failures.length, failedProcessCount: failures.length })
  for (const result of failures) if (result.status === 'rejected')
    logger.error({ event: 'process.shutdown_failure', error: result.reason })
  clearRegistry()
}
