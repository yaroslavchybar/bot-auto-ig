import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import type { Profile } from '../tabs/profiles/types'

const STORAGE_KEY = 'cached_profiles'

export function useProfiles() {
    const [profiles, setProfiles] = useState<Profile[]>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY)
            return stored ? JSON.parse(stored) : []
        } catch {
            return []
        }
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchProfiles = useCallback(async (background = false) => {
        if (!background) setLoading(true)
        setError(null)
        try {
            const data = await apiFetch<Profile[]>('/api/profiles')
            setProfiles(data)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
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
