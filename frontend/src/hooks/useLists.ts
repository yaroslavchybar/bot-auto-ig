import { useState, useEffect, useCallback } from 'react'
import { fetchLists } from '../tabs/lists/api'
import type { List } from '../tabs/lists/types'

const STORAGE_KEY = 'cached_lists'
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

export function useLists() {
    const [lists, setLists] = useState<List[]>(() => {
        return getCache<List[]>(STORAGE_KEY) ?? []
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const refreshLists = useCallback(async (background = false) => {
        if (!background) setLoading(true)
        setError(null)
        try {
            const data = await fetchLists()
            setLists(data)
            setCache(STORAGE_KEY, data)
            return data
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
            throw e
        } finally {
            if (!background) setLoading(false)
        }
    }, [])

    useEffect(() => {
        // Initial fetch (background update)
        void refreshLists(true)
    }, [refreshLists])

    return {
        lists,
        loading,
        error,
        refresh: () => refreshLists(false),
        backgroundRefresh: () => refreshLists(true),
        setLists,
    }
}

