import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { LogEntry } from '@/lib/logs'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useIsMobile } from '@/hooks/use-mobile'

export type LogsMode = 'live' | 'static'

export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug' | 'all'

export type LogFileItem = {
  label: string
  value: string
}

export const FEED_DEBUG_TAGS = [
  '[feed-like-debug]',
  '[feed-scroll-debug]',
] as const
export const LOGS_PAGE_SIZE = 30

export const isFeedDebugMessage = (message: string) => {
  const lowered = String(message || '').toLowerCase()
  return FEED_DEBUG_TAGS.some((tag) => lowered.includes(tag))
}

export const LevelAppearance: Record<
  LogLevel | string,
  { text: string; bg: string }
> = {
  info: { text: 'text-status-info', bg: 'hover:bg-status-info-soft' },
  warn: {
    text: 'text-status-warning font-medium',
    bg: 'bg-status-warning-soft hover:bg-status-warning-strong',
  },
  error: {
    text: 'text-status-danger font-semibold',
    bg: 'bg-status-danger-soft hover:bg-status-danger-strong border-l-2 border-l-status-danger-border',
  },
  success: {
    text: 'text-status-success font-medium',
    bg: 'bg-status-success-soft hover:bg-status-success-strong',
  },
  debug: { text: 'text-subtle-copy', bg: 'hover:bg-panel-muted' },
  all: { text: '', bg: '' },
}

interface UseLogsStateOptions {
  workflowId?: string | null
  profileName?: string | null
}

export function useLogsState({
  workflowId = null,
  profileName = null,
}: UseLogsStateOptions = {}) {
  const isMobile = useIsMobile()
  const liveBufferSize = isMobile ? 250 : 1000

  const {
    mode, wsConnected, logs, loading, filesLoading, refreshing, error,
    files, selectedFile,
    switchToLive: doSwitchToLive,
    switchToStatic: doSwitchToStatic,
    handleRefresh, handleClearLive,
    handleFileChange: doHandleFileChange,
  } = useLogsFetching(liveBufferSize, workflowId)

  const {
    filteredLogs, visibleLogs, hasMoreLogs, loadMoreLogs,
    resetVisibleCount,
    filterQuery, setFilterQuery, levelFilter, setLevelFilter,
    showTime, setShowTime, showSource, setShowSource,
    showProfile, setShowProfile, autoScroll, setAutoScroll,
    feedDebugOnly, setFeedDebugOnly,
  } = useLogsFiltering({ logs, workflowId, profileName })

  // Wrap mode/file actions to also reset visible count
  const switchToLive = useCallback(() => {
    doSwitchToLive()
    resetVisibleCount()
  }, [doSwitchToLive, resetVisibleCount])

  const switchToStatic = useCallback(() => {
    doSwitchToStatic()
    resetVisibleCount()
  }, [doSwitchToStatic, resetVisibleCount])

  const handleFileChange = useCallback(
    (value: string) => {
      doHandleFileChange(value)
      resetVisibleCount()
    },
    [doHandleFileChange, resetVisibleCount],
  )

  return {
    mode, wsConnected, switchToLive, switchToStatic,
    logs, filteredLogs, visibleLogs, hasMoreLogs, loadMoreLogs,
    loading, filesLoading, refreshing, error,
    files, selectedFile, handleFileChange,
    handleRefresh, handleClearLive,
    filterQuery, setFilterQuery, levelFilter, setLevelFilter,
    showTime, setShowTime, showSource, setShowSource,
    showProfile, setShowProfile, autoScroll, setAutoScroll,
    feedDebugOnly, setFeedDebugOnly,
  }
}

// --- Fetching hook: data loading, WebSocket, mode switching ---

function useLogsFetching(
  liveBufferSize: number,
  workflowId: string | null | undefined,
) {
  const [mode, setMode] = useState<LogsMode>('live')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filesLoading, setFilesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [files, setFiles] = useState<LogFileItem[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { logs: wsLogs, connected: wsConnected } = useWebSocket({
    workflowId,
    enabled: mode === 'live',
    pauseWhenHidden: true,
    maxBuffer: liveBufferSize,
  })

  const processedWsLogsRef = useRef(0)

  const loadLiveLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<LogEntry[]>('/api/logs')
      setLogs(data.slice(-liveBufferSize))
      processedWsLogsRef.current = 0
      setMode('live')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [liveBufferSize])

  const loadFiles = useCallback(async () => {
    setFilesLoading(true)
    setError(null)
    try {
      const data = await apiFetch<string[]>('/api/logs/files')
      const items = (data || []).map((f) => ({ label: f, value: f }))
      setFiles(items)
      if (!selectedFile && items[0]) {
        setSelectedFile(items[0].value)
      }
      return items
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return []
    } finally {
      setFilesLoading(false)
    }
  }, [selectedFile])

  const loadFileLogs = useCallback(
    async (filename: string) => {
      if (!filename) return
      setLoading(true)
      setError(null)
      try {
        const data = await apiFetch<LogEntry[]>(
          `/api/logs/file/${encodeURIComponent(filename)}`,
        )
        setLogs(data.slice(-liveBufferSize))
        setMode('static')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [liveBufferSize],
  )

  const refreshStaticLogs = useCallback(async () => {
    const items = await loadFiles()
    const nextFile = selectedFile
      ? items.find((item) => item.value === selectedFile)?.value ?? null
      : (items[0]?.value ?? null)

    if (!nextFile) {
      setSelectedFile(null)
      setLogs([])
      return
    }
    if (nextFile !== selectedFile) {
      setSelectedFile(nextFile)
      return
    }
    await loadFileLogs(nextFile)
  }, [loadFileLogs, loadFiles, selectedFile])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        mode === 'live' ? loadLiveLogs() : refreshStaticLogs(),
        new Promise((resolve) => setTimeout(resolve, 300)),
      ])
    } finally {
      setRefreshing(false)
    }
  }, [loadLiveLogs, mode, refreshStaticLogs])

  const handleClearLive = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await apiFetch('/api/logs', { method: 'DELETE' })
      setLogs([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Load live logs on mount
  useEffect(() => {
    void loadLiveLogs()
  }, [loadLiveLogs])

  // Merge WebSocket logs in live mode
  useWsLogMerge(mode, wsLogs, processedWsLogsRef, liveBufferSize, setLogs)

  // Load files when switching to static mode
  useEffect(() => {
    if (mode === 'static' && files.length === 0 && !filesLoading) {
      void loadFiles()
    }
  }, [files.length, filesLoading, loadFiles, mode])

  // Load file logs when selected file changes
  useEffect(() => {
    if (mode === 'static' && selectedFile) {
      void loadFileLogs(selectedFile)
    }
  }, [mode, selectedFile, loadFileLogs])

  const switchToLive = useCallback(() => {
    setMode('live')
    void loadLiveLogs()
  }, [loadLiveLogs])

  const switchToStatic = useCallback(() => {
    setMode('static')
  }, [])

  const handleFileChange = useCallback((value: string) => {
    setSelectedFile(value)
    setMode('static')
  }, [])

  return {
    mode,
    wsConnected,
    logs,
    loading,
    filesLoading,
    refreshing,
    error,
    files,
    selectedFile,
    switchToLive,
    switchToStatic,
    handleRefresh,
    handleClearLive,
    handleFileChange,
  }
}

// --- WebSocket log merge effect (extracted for size) ---

function useWsLogMerge(
  mode: LogsMode,
  wsLogs: LogEntry[],
  processedRef: React.MutableRefObject<number>,
  bufferSize: number,
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>,
) {
  useEffect(() => {
    if (mode !== 'live') return
    if (wsLogs.length < processedRef.current) {
      processedRef.current = 0
    }

    const newEntries = wsLogs.slice(processedRef.current)
    if (newEntries.length === 0) return

    processedRef.current = wsLogs.length

    setLogs((prev) => {
      const seen = new Set(prev.map((e) => `${e.ts}-${e.message}`))
      const appended = [...prev]

      for (const w of newEntries) {
        const key = `${w.ts}-${w.message}`
        if (!seen.has(key)) {
          seen.add(key)
          appended.push({ ...w, profileName: w.profileName || undefined })
        }
      }

      return appended.slice(-bufferSize)
    })
  }, [bufferSize, mode, wsLogs, processedRef, setLogs])
}

// --- Filtering hook: filter state, visible logs, pagination ---

interface UseLogsFilteringOptions {
  logs: LogEntry[]
  workflowId: string | null | undefined
  profileName: string | null | undefined
}

function useLogsFiltering({
  logs,
  workflowId,
  profileName,
}: UseLogsFilteringOptions) {
  const [filterQuery, setFilterQueryRaw] = useState('')
  const [levelFilter, setLevelFilterRaw] = useState<LogLevel>('all')
  const [showTime, setShowTime] = useState(true)
  const [showSource, setShowSource] = useState(false)
  const [showProfile, setShowProfile] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [feedDebugOnly, setFeedDebugOnlyRaw] = useState(false)
  const [visibleCount, setVisibleCount] = useState(LOGS_PAGE_SIZE)

  const resetVisibleCount = useCallback(() => setVisibleCount(LOGS_PAGE_SIZE), [])

  // Wrap filter setters to auto-reset visible count
  const setFilterQuery = useCallback(
    (v: string | ((prev: string) => string)) => { setFilterQueryRaw(v); resetVisibleCount() },
    [resetVisibleCount],
  )
  const setLevelFilter = useCallback(
    (v: LogLevel) => { setLevelFilterRaw(v); resetVisibleCount() },
    [resetVisibleCount],
  )
  const setFeedDebugOnly = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => { setFeedDebugOnlyRaw(v); resetVisibleCount() },
    [resetVisibleCount],
  )

  const filteredLogs = useMemo(
    () => filterLogs(logs, { workflowId, profileName, levelFilter, feedDebugOnly, filterQuery }),
    [logs, filterQuery, levelFilter, feedDebugOnly, workflowId, profileName],
  )
  const visibleLogs = useMemo(
    () => filteredLogs.slice(Math.max(filteredLogs.length - visibleCount, 0)),
    [filteredLogs, visibleCount],
  )
  const hasMoreLogs = visibleLogs.length < filteredLogs.length
  const loadMoreLogs = useCallback(
    () => setVisibleCount((prev) => Math.min(prev + LOGS_PAGE_SIZE, filteredLogs.length)),
    [filteredLogs.length],
  )

  return {
    filterQuery, setFilterQuery, levelFilter, setLevelFilter,
    showTime, setShowTime, showSource, setShowSource,
    showProfile, setShowProfile, autoScroll, setAutoScroll,
    feedDebugOnly, setFeedDebugOnly,
    filteredLogs, visibleLogs, hasMoreLogs, loadMoreLogs, resetVisibleCount,
  }
}

// --- Pure filtering logic ---

interface FilterOptions {
  workflowId: string | null | undefined
  profileName: string | null | undefined
  levelFilter: LogLevel
  feedDebugOnly: boolean
  filterQuery: string
}

function filterLogs(logs: LogEntry[], opts: FilterOptions): LogEntry[] {
  const q = opts.filterQuery.trim().toLowerCase()
  const scopedProfile = String(opts.profileName || '')
    .trim()
    .toLowerCase()

  return logs.filter((log) => {
    if (opts.workflowId) {
      const logWfId = String(log.workflowId || '').trim()
      if (!logWfId || logWfId !== opts.workflowId) return false
    }
    if (scopedProfile) {
      const logProfile = String(log.profileName || '').trim().toLowerCase()
      if (!logProfile || logProfile !== scopedProfile) return false
    }
    if (
      opts.levelFilter !== 'all' &&
      String(log.level || '').toLowerCase() !== opts.levelFilter
    ) {
      return false
    }
    if (opts.feedDebugOnly && !isFeedDebugMessage(String(log.message || ''))) {
      return false
    }
    if (!q) return true
    return matchesQuery(log, q)
  })
}

function matchesQuery(log: LogEntry, q: string): boolean {
  const msg = String(log.message || '').toLowerCase()
  const src = String(log.source || '').toLowerCase()
  const profile = String(log.profileName || '').toLowerCase()
  const taskId = String(log.taskId || '').toLowerCase()
  const target = String(log.targetUsername || '').toLowerCase()
  const errorCode = String(log.errorCode || '').toLowerCase()
  const outcome = String(log.outcome || '').toLowerCase()
  const diagnostics = String(log.diagnostics || '').toLowerCase()
  return (
    msg.includes(q) ||
    src.includes(q) ||
    profile.includes(q) ||
    taskId.includes(q) ||
    target.includes(q) ||
    errorCode.includes(q) ||
    outcome.includes(q) ||
    diagnostics.includes(q)
  )
}
