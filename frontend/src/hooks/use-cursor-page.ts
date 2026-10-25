import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PAGE_SIZE, isPageSize, type PageSize } from '../../../server/shared/pagination'

// Read before the first query so a refresh does not fetch the default page size first.
export function usePageSize(table: string) {
  const storageKey = `table-page-size:${table}`
  const [pageSize, setPageSize] = useState<PageSize>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      return isPageSize(saved) ? saved : DEFAULT_PAGE_SIZE
    } catch {
      return DEFAULT_PAGE_SIZE
    }
  })
  const changePageSize = useCallback(
    (value: PageSize) => {
      setPageSize(value)
      try {
        localStorage.setItem(storageKey, String(value))
      } catch {
        // Keep the table usable when browser storage is unavailable.
      }
    },
    [storageKey],
  )
  return [pageSize, changePageSize] as const
}

export function useDebouncedSearch(value: string) {
  const normalized = value.trim().toLowerCase()
  const [search, setSearch] = useState(normalized)
  useEffect(() => {
    const timer = setTimeout(() => setSearch(normalized), 200)
    return () => clearTimeout(timer)
  }, [normalized])
  return search
}

export function useCursorPage(key: string) {
  const initial = { key, positions: [{ cursor: null as string | null, offset: 0, endCursor: undefined as string | undefined }], index: 0 }
  const [position, setPosition] = useState(initial)
  if (position.key !== key) setPosition(initial)
  const current = position.key === key ? position : initial
  const selected = current.positions[current.index]!
  return {
    ...selected,
    pageNumber: current.index + 1,
    hasPrevious: current.index > 0,
    reset: () => setPosition(initial),
    previous: () => setPosition({ ...current, index: Math.max(0, current.index - 1) }),
    // Skip an empty batch or reposition within a live page without adding history.
    replace: (cursor: string | null, offset = 0) => setPosition({ ...current,
      positions: current.positions.map((value, index) => index === current.index
        ? { cursor, offset, endCursor: cursor === value.cursor ? value.endCursor : undefined } : value),
    }),
    // Preserve the range being left so its overflow offsets survive a fresh subscription.
    next: (cursor: string | null, offset = 0, rangeEnd?: string) =>
      setPosition({
        key,
        positions: [
          ...current.positions.slice(0, current.index + 1).map(value =>
            rangeEnd !== undefined && value.cursor === selected.cursor ? { ...value, endCursor: rangeEnd } : value),
          { cursor, offset, endCursor: cursor === selected.cursor ? selected.endCursor : undefined },
        ],
        index: current.index + 1,
      }),
  }
}
