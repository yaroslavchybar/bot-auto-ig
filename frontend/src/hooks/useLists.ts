import { useState, useEffect, useCallback } from 'react'
import { fetchLists } from '../tabs/lists/api'
import type { List } from '../tabs/lists/types'

const STORAGE_KEY = 'cached_lists'

export function useLists() {
    const [lists, setLists] = useState<List[]>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY)
            return stored ? JSON.parse(stored) : []
        } catch {
            return []
        }
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const refreshLists = useCallback(async (background = false) => {
        if (!background) setLoading(true)
        setError(null)
        try {
            const data = await fetchLists()
            setLists(data)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
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
