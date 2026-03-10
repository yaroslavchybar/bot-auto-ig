import { useState, useEffect, useCallback, useMemo } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Profile } from '../types'
import { mapProfileRecord } from '../utils/mapProfile'

const STORAGE_KEY = 'cached_profiles'
const CACHE_VERSION = 1
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry<T> {
  version: number
  timestamp: number
  data: T
}

function getCache<T>(key: string): T | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null
  }

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (entry.version !== CACHE_VERSION) return null
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null
    return entry.data
  } catch {
    return null
  }
}

function setCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return
  }

  const entry: CacheEntry<T> = {
    version: CACHE_VERSION,
    timestamp: Date.now(),
    data,
  }
  localStorage.setItem(key, JSON.stringify(entry))
}

export function useProfiles() {
  const convex = useConvex()
  const liveProfiles = useQuery(api.profiles.list, {})
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    return getCache<Profile[]>(STORAGE_KEY) ?? []
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchProfiles = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    setError(null)
    try {
      const data = await convex.query(api.profiles.list, {})
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



