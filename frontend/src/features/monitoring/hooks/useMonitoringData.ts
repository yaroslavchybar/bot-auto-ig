import { useCallback, useEffect, useState } from 'react'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { usePerformanceMode } from '@/hooks/use-performance-mode'
import { apiFetch } from '@/lib/api'
import { env } from '@/lib/env'

const POLL_INTERVAL = 5000
const MOBILE_POLL_INTERVAL = 20000

export interface MonitoringData {
  cpu: { percent: number; cores: number; model: string }
  memory: {
    total: number
    used: number
    free: number
    percent: number
    totalFormatted: string
    usedFormatted: string
    freeFormatted: string
  }
  disk: {
    total: number
    used: number
    free: number
    percent: number
    totalFormatted: string
    usedFormatted: string
    freeFormatted: string
  }
  system: {
    hostname: string
    platform: string
    arch: string
    release: string
    uptime: number
    uptimeFormatted: string
  }
  network: Record<
    string,
    Array<{
      address: string
      netmask: string
      family: string
      mac: string
      internal: boolean
    }>
  >
  timestamp: string
}

export function useMonitoringData() {
  const performanceMode = usePerformanceMode()
  const isVisible = useDocumentVisibility()
  const [data, setData] = useState<MonitoringData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [retrying, setRetrying] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const endpoint = env.isDev
        ? `${env.apiUrl}/api/monitoring`
        : '/api/monitoring'
      const result = await apiFetch<MonitoringData>(endpoint)
      setData(result)
      setLastUpdate(new Date())
      setError(null)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch monitoring data',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const handleRetry = useCallback(async () => {
    setRetrying(true)
    try {
      await fetchData()
    } finally {
      setRetrying(false)
    }
  }, [fetchData])

  useEffect(() => {
    if (!isVisible) return
    fetchData()
    const interval = setInterval(
      fetchData,
      performanceMode ? MOBILE_POLL_INTERVAL : POLL_INTERVAL,
    )
    return () => clearInterval(interval)
  }, [fetchData, isVisible, performanceMode])

  return { data, loading, error, lastUpdate, retrying, handleRetry }
}
