import type { Server } from 'node:http'
import { closeConvexRealtime } from '../shared/convexRealtime.js'
import { runtimeRequest, stopRuntime } from '../shared/runtime.js'
import { logOperation } from '../shared/logger.js'
import { shutdownBrowserLogins } from '../ig-accounts/login.js'

let stopping = false
export function registerShutdownHandlers(deps: { httpServer: Server }): void {
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    try {
      await logOperation('server.shutdown', { signal }, async () => {
        deps.httpServer.close()
        await shutdownBrowserLogins()
        await closeConvexRealtime()
        await runtimeRequest('/processes/shutdown', {
          method: 'POST',
          body: '{}',
          signal: AbortSignal.timeout(60_000),
        })
        await stopRuntime()
      })
      process.exit(0)
    } catch {
      await stopRuntime()
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
