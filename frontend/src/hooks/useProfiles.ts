import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import type { Profile } from '../tabs/profiles/types'

const STORAGE_KEY = 'cached_profiles'
const CACHE_VERSION = 1
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry<T> {
    version: number
    timestamp: number
    data: T
}

function getCache<T>(key: string): T | null {
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
    const entry: CacheEntry<T> = { version: CACHE_VERSION, timestamp: Date.now(), data }
    localStorage.setItem(key, JSON.stringify(entry))
}

export function useProfiles() {
    const [profiles, setProfiles] = useState<Profile[]>(() => {
        return getCache<Profile[]>(STORAGE_KEY) ?? []
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchProfiles = useCallback(async (background = false) => {
        if (!background) setLoading(true)
        setError(null)
        try {
            const data = await apiFetch<Profile[]>('/api/profiles')
            setProfiles(data)
            setCache(STORAGE_KEY, data)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            if (!background) setLoading(false)
        }
    }, [])

    useEffect(() => {
        // Initial fetch (background update while showing cached data)
        void fetchProfiles(true)
    }, [fetchProfiles])

    return {
        profiles,
        loading, // Mostly false unless manual refresh is triggered
        error,
        refresh: () => fetchProfiles(false), // Manual refresh shows loading state
        backgroundRefresh: () => fetchProfiles(true), // Background refresh doesn't show loading state
        setProfiles, // Exposed for optimistic updates if needed
    }
}

