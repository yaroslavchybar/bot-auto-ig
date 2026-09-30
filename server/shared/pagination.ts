export type CursorPage<T> = { page: T[]; continueCursor: string; isDone: boolean }
export const SCAN_BATCH_LIMIT = 5
export const SCAN_BATCH_BYTES = 512 * 1024

// Scan bounded batches to preserve substring search without sending unmatched rows to clients.
export async function scanPage<T>(
  fetchPage: (cursor: string | null, count: number) => Promise<CursorPage<T>>,
  matches: (row: T) => boolean,
  cursor: string | null,
  pageSize = 50,
): Promise<CursorPage<T>> {
  const page: T[] = []
  let next = cursor
  for (let batches = 1; ; batches++) {
    const batch = await fetchPage(next, pageSize - page.length)
    page.push(...batch.page.filter(matches))
    if (batch.isDone || page.length >= pageSize)
      return { page, continueCursor: batch.continueCursor, isDone: batch.isDone }
    if (batch.continueCursor === next) throw new Error('Pagination cursor did not advance')
    if (batches >= SCAN_BATCH_LIMIT)
      return { page, continueCursor: batch.continueCursor, isDone: false }
    next = batch.continueCursor
  }
}

export function matchesSearch(search: string, fields: unknown[]): boolean {
  return fields.some((field) =>
    String(field ?? '')
      .toLowerCase()
      .includes(search),
  )
}
