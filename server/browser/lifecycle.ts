const controller = new AbortController()
export const shutdownSignal = controller.signal
export const shouldStop = () => shutdownSignal.aborted

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
