/** One in-flight write and one replacement snapshot; snapshots must be cumulative. */
export function latestQueue<T>(write: (value: T) => Promise<void>) {
  let pending: { value: T } | undefined
  let running: Promise<void> | undefined
  return {
    push(value: T): Promise<void> {
      pending = { value }
      if (!running) {
        // Capture the first snapshot synchronously. Otherwise sync push()
        // calls overwrite pending before the microtask runs and only the
        // last value is written.
        let next: { value: T } | undefined = pending
        pending = undefined
        running = Promise.resolve().then(async () => {
          try {
            while (next) {
              const current = next
              next = undefined
              await write(current.value)
              // Adopt whatever arrived during the write (coalesced to latest).
              if (pending) {
                next = pending
                pending = undefined
              }
            }
          } finally { running = undefined }
        })
      }
      return running
    },
  }
}
