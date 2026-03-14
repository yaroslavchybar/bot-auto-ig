import { useState, useEffect, useCallback, useMemo } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Profile } from '../types'
import { mapProfileRecord } from '../utils/mapProfile'
import { getCache, setCache } from '@/lib/cache'
import { useErrorHandler } from '@/hooks/useErrorHandler'

const STORAGE_KEY = 'cached_profiles'

export function useProfiles() {
  const convex = useConvex()
  const { handleError } = useErrorHandler()
  const liveProfiles = useQuery(api.profiles.queries.list, {})
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    return getCache<Profile[]>(STORAGE_KEY) ?? []
  })
  const [loading, setLoading] = useState(false)

  const fetchProfiles = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const data = await convex.query(api.profiles.queries.list, {})
      const mapped = data.map(mapProfileRecord)
      setProfiles(mapped)
      setCache(STORAGE_KEY, mapped)
    } catch (e) {
      handleError(e, 'Profiles fetch')
    } finally {
      if (!background) setLoading(false)
    }
  }, [convex, handleError])

  useEffect(() => {
    if (!liveProfiles) return

    const mapped = liveProfiles.map(mapProfileRecord)
    setProfiles(mapped)
    setCache(STORAGE_KEY, mapped)
  }, [liveProfiles])

  const refresh = useCallback(() => fetchProfiles(false), [fetchProfiles])
  const backgroundRefresh = useCallback(
    () => fetchProfiles(true),
    [fetchProfiles],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Initial fetch (background update while showing cached data)
    void backgroundRefresh()
  }, [backgroundRefresh])

  return useMemo(
    () => ({
      profiles,
      loading, // Mostly false unless manual refresh is triggered
      refresh, // Manual refresh shows loading state
      backgroundRefresh, // Background refresh doesn't show loading state
      setProfiles, // Exposed for optimistic updates if needed
    }),
    [profiles, loading, refresh, backgroundRefresh],
  )
}



