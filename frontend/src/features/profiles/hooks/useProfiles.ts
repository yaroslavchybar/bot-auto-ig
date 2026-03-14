import { useState, useEffect, useCallback, useMemo } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Profile } from '../types'
import { mapProfileRecord } from '../utils/mapProfile'
import { getCache, setCache } from '@/lib/cache'

const STORAGE_KEY = 'cached_profiles'

export function useProfiles() {
  const convex = useConvex()
  const liveProfiles = useQuery(api.profiles.queries.list, {})
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    return getCache<Profile[]>(STORAGE_KEY) ?? []
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchProfiles = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    setError(null)
    try {
      const data = await convex.query(api.profiles.queries.list, {})
      const mapped = data.map(mapProfileRecord)
      setProfiles(mapped)
      setCache(STORAGE_KEY, mapped)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!background) setLoading(false)
    }
  }, [convex])

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
      error,
      refresh, // Manual refresh shows loading state
      backgroundRefresh, // Background refresh doesn't show loading state
      setProfiles, // Exposed for optimistic updates if needed
    }),
    [profiles, loading, error, refresh, backgroundRefresh],
  )
}



