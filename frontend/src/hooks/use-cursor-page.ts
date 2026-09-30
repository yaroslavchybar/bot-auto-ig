import { useEffect, useState } from 'react'

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
  const initial = { key, cursors: [null] as (string | null)[], index: 0 }
  const [position, setPosition] = useState(initial)
  if (position.key !== key) setPosition(initial)
  const current = position.key === key ? position : initial
  return {
    cursor: current.cursors[current.index] ?? null,
    pageNumber: current.index + 1,
    hasPrevious: current.index > 0,
    previous: () => setPosition({ ...current, index: Math.max(0, current.index - 1) }),
    next: (cursor: string) =>
      setPosition({
        key,
        cursors: [...current.cursors.slice(0, current.index + 1), cursor],
        index: current.index + 1,
      }),
  }
}
