const controller = new AbortController()
export const shutdownSignal = controller.signal
export const shouldStop = () => shutdownSignal.aborted

/**
 * Programmatic stop for runners. Signals (SIGTERM/SIGBREAK) are the same
 * trigger on Unix, but on Windows under Bun they never reach detached
 * children — so the server asks for a stop over stdin instead and every
 * runner funnels through here.
 */
export function requestStop(): void {
  if (!shutdownSignal.aborted)
    controller.abort(new Error('Browser worker stopped'))
}

/**
 * Detach stdin before exiting. The parent keeps its write end open, so a
 * lingering `data` listener would hold the event loop (and the process)
 * alive forever after the work is done.
 */
export function releaseStdin(): void {
  try {
    process.stdin.removeAllListeners('data')
    process.stdin.removeAllListeners('end')
    process.stdin.removeAllListeners('error')
    process.stdin.pause()
  } catch { /* stdio may be ignored */ }
}

for (const signal of process.platform === 'win32'
  ? (['SIGINT', 'SIGTERM', 'SIGBREAK'] as const)
  : (['SIGINT', 'SIGTERM'] as const)) {
  process.once(signal, () =>
    controller.abort(new Error('Browser worker stopped')),
  )
}

export function sleep(ms: number): Promise<void> {
  shutdownSignal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(shutdownSignal.reason)
    }
    const timer = setTimeout(() => {
      shutdownSignal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    shutdownSignal.addEventListener('abort', onAbort, { once: true })
  })
}
