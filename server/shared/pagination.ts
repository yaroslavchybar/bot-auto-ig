export type CursorPage<T> = { page: T[]; continueCursor: string; isDone: boolean }

// Rows per page the table footer offers. Server scans may request any smaller count internally.
export const PAGE_SIZES = [10, 25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 50
export const MAX_PAGE_SIZE = 100

/** True when the value is one of the page sizes the footer can request. */
export function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value)
}

export const SCAN_BATCH_BYTES = 512 * 1024

// Scan one bounded database page per query. Sparse filtered pages resume with Convex's native
// cursor, avoiding nested .paginate() calls and remaining stable as rows change.
export async function scanPage<T>(
  fetchPage: (cursor: string | null, count: number) => Promise<CursorPage<T>>,
  matches: (row: T) => boolean,
  cursor: string | null,
  pageSize = 50,
): Promise<CursorPage<T>> {
  const batch = await fetchPage(cursor, pageSize)
  if (!batch.isDone && batch.continueCursor === cursor)
    throw new Error('Pagination cursor did not advance')
  return { page: batch.page.filter(matches), continueCursor: batch.continueCursor, isDone: batch.isDone }
}

export function matchesSearch(search: string, fields: unknown[]): boolean {
  return fields.some((field) =>
    String(field ?? '')
      .toLowerCase()
      .includes(search),
  )
}
