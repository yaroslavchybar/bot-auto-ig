/** Keep slots busy, but stop admitting work after a failure and drain active jobs. */
export async function runPool<T>(items: readonly T[], concurrency: number,
  run: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  let failed = false
  let failure: unknown
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(concurrency))) }, async () => {
    while (!failed && next < items.length) {
      const index = next++
      try { await run(items[index], index) }
      catch (error) { if (!failed) { failed = true; failure = error } }
    }
  }))
  if (failed) throw failure
}
