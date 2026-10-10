import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCursorPage, useDebouncedSearch, usePageSize } from '@/hooks/use-cursor-page'
import { type CursorPage } from '../../../../../server/shared/pagination'
import type { Account } from '../components/AccountsList'

// Changing the page size resets paging to page 1 because it is part of the cursor key.
export function useAccountsPage(value: string, profileId?: string, enabled = true) {
  const search = useDebouncedSearch(value)
  const [pageSize, setPageSize] = usePageSize('ig-accounts')
  const position = useCursorPage(JSON.stringify([search, profileId, pageSize]))
  const [revision, setRevision] = useState(0)
  const params = new URLSearchParams({ search, pageSize: String(pageSize) })
  if (position.cursor) params.set('cursor', position.cursor)
  if (profileId) params.set('profileId', profileId)
  const path = `/api/ig-accounts/page?${params}`
  const key = `${path}:${revision}`
  const [state, setState] = useState<{ key: string; data?: CursorPage<Account>; error: string }>({
    key: '',
    error: '',
  })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void apiFetch<CursorPage<Account>>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data, error: '' })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ key, error: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [path, key, enabled])

  const data = enabled && state.key === key ? state.data : undefined
  const loading = enabled && state.key !== key
  const refresh = useCallback(async () => {
    setRevision((current) => current + 1)
  }, [])
  return {
    accounts: data?.page ?? [],
    loading,
    error: state.key === key ? state.error : '',
    refresh,
    pageSize,
    setPageSize,
    pagination: {
      ...position,
      loading,
      hasNext: Boolean(data && !data.isDone),
      next: () => {
        if (data && !data.isDone) position.next(data.continueCursor)
      },
    },
  }
}
