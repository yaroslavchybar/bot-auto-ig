import { useState, useEffect, useCallback } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { List } from '../types'
import { getCache, setCache } from '@/lib/cache'
import { useErrorHandler } from '@/hooks/useErrorHandler'

const STORAGE_KEY = 'cached_lists'

export function useLists() {
  const convex = useConvex()
  const { handleError } = useErrorHandler()
  const liveLists = useQuery(api.lists.list, {})
  const [lists, setLists] = useState<List[]>(() => {
    return getCache<List[]>(STORAGE_KEY) ?? []
  })
  const [loading, setLoading] = useState(false)

  const refreshLists = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const data = await convex.query(api.lists.list, {})
      const mapped = data.map((list) => ({
        id: String(list._id),
        name: String(list.name),
      }))
      setLists(mapped)
      setCache(STORAGE_KEY, mapped)
      return mapped
    } catch (e) {
      handleError(e, 'Lists fetch')
      throw e
    } finally {
      if (!background) setLoading(false)
    }
  }, [convex, handleError])

  useEffect(() => {
    if (!liveLists) return

    const mapped = liveLists.map((list) => ({
      id: String(list._id),
      name: String(list.name),
    }))
    setLists(mapped)
    setCache(STORAGE_KEY, mapped)
  }, [liveLists])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Initial fetch (background update)
    void refreshLists(true)
  }, [refreshLists])

  return {
    lists,
    loading,
    refresh: () => refreshLists(false),
    backgroundRefresh: () => refreshLists(true),
    setLists,
  }
}



