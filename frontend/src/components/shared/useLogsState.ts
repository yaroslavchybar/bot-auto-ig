import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { LogEntry } from '@/lib/logs'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useIsMobile } from '@/hooks/use-mobile'
import { useErrorHandler } from '@/hooks/useErrorHandler'

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
  const { handleError } = useErrorHandler()

  const {
    mode, wsConnected, logs, loading, filesLoading, refreshing,
    files, selectedFile,
    switchToLive: doSwitchToLive,
    switchToStatic: doSwitchToStatic,
    handleRefresh, handleClearLive,
    handleFileChange: doHandleFileChange,
    inlineError, dismissError,
  } = useLogsFetching(liveBufferSize, workflowId, handleError)

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
    loading, filesLoading, refreshing,
    files, selectedFile, handleFileChange,
    handleRefresh, handleClearLive,
    inlineError, dismissError,
    filterQuery, setFilterQuery, levelFilter, setLevelFilter,
    showTime, setShowTime, showSource, setShowSource,
    showProfile, setShowProfile, autoScroll, setAutoScroll,
    feedDebugOnly, setFeedDebugOnly,
  }
}

// --- Core state for logs fetching ---

function useLogsCoreState(
  liveBufferSize: number,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const [mode, setMode] = useState<LogsMode>('live')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filesLoading, setFilesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [files, setFiles] = useState<LogFileItem[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const processedWsLogsRef = useRef(0)

  /** Report to toast + Sentry AND surface in the panel */
  const handleErrorWithInline = useCallback(
    (error: unknown, context?: string) => {
      const msg = handleError(error, context)
      setInlineError(msg)
    },
    [handleError],
  )

  return {
    mode, setMode, logs, setLogs, loading, setLoading,
    filesLoading, setFilesLoading, refreshing, setRefreshing,
    files, setFiles, selectedFile, setSelectedFile,
    handleError: handleErrorWithInline, inlineError, setInlineError,
    processedWsLogsRef, liveBufferSize,
  }
}

// --- Data loading helpers ---

function useLogsDataLoading(state: ReturnType<typeof useLogsCoreState>) {
  const {
    liveBufferSize, setLoading, handleError, setInlineError, setLogs,
    processedWsLogsRef, setMode, selectedFile,
    setFilesLoading, setFiles, setSelectedFile,
  } = state

  const loadLiveLogs = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<LogEntry[]>('/api/logs')
      setLogs(data.slice(-liveBufferSize))
      processedWsLogsRef.current = 0
      setMode('live')
      setInlineError(null)
    } catch (e) {
      handleError(e, 'Load logs')
    } finally {
      setLoading(false)
    }
  }, [liveBufferSize, processedWsLogsRef, handleError, setInlineError, setLoading, setLogs, setMode])

  const loadFiles = useCallback(async () => {
    setFilesLoading(true)
    try {
      const data = await apiFetch<string[]>('/api/logs/files')
      const items = (data || []).map((f) => ({ label: f, value: f }))
      setFiles(items)
      if (!selectedFile && items[0]) setSelectedFile(items[0].value)
      setInlineError(null)
      return items
    } catch (e) {
      handleError(e, 'Load log files')
      return []
    } finally {
      setFilesLoading(false)
    }
  }, [selectedFile, handleError, setInlineError, setFiles, setFilesLoading, setSelectedFile])

  const loadFileLogs = useCallback(
    async (filename: string) => {
      if (!filename) return
      setLoading(true)
      try {
        const data = await apiFetch<LogEntry[]>(
          `/api/logs/file/${encodeURIComponent(filename)}`,
        )
        setLogs(data.slice(-liveBufferSize))
        setMode('static')
        setInlineError(null)
      } catch (e) {
        handleError(e, 'Load file logs')
      } finally {
        setLoading(false)
      }
    },
    [liveBufferSize, handleError, setInlineError, setLoading, setLogs, setMode],
  )

  return { loadLiveLogs, loadFiles, loadFileLogs }
}

// --- Fetching hook: data loading, WebSocket, mode switching ---

function useLogsFetching(
  liveBufferSize: number,
  workflowId: string | null | undefined,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const state = useLogsCoreState(liveBufferSize, handleError)
  const {
    mode, setMode, logs, loading, filesLoading, refreshing, setRefreshing,
    files, selectedFile, setSelectedFile, setLogs, setLoading,
    processedWsLogsRef, inlineError, setInlineError,
  } = state
  const { loadLiveLogs, loadFiles, loadFileLogs } = useLogsDataLoading(state)

  const { logs: wsLogs, connected: wsConnected } = useWebSocket({
    workflowId,
    enabled: mode === 'live',
    pauseWhenHidden: true,
    maxBuffer: liveBufferSize,
  })

  const refreshStaticLogs = useCallback(async () => {
    const items = await loadFiles()
    const nextFile = selectedFile
      ? items.find((item) => item.value === selectedFile)?.value ?? null
      : (items[0]?.value ?? null)
    if (!nextFile) { setSelectedFile(null); setLogs([]); return }
    if (nextFile !== selectedFile) { setSelectedFile(nextFile); return }
    await loadFileLogs(nextFile)
  }, [loadFileLogs, loadFiles, selectedFile, setLogs, setSelectedFile])

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
  }, [loadLiveLogs, mode, refreshStaticLogs, setRefreshing])

  const handleClearLive = useCallback(async () => {
    setLoading(true)
    try {
      await apiFetch('/api/logs', { method: 'DELETE' })
      setLogs([])
      setInlineError(null)
    } catch (e) {
      handleError(e, 'Clear logs')
    } finally {
      setLoading(false)
    }
  }, [handleError, setInlineError, setLoading, setLogs])

  useEffect(() => { void loadLiveLogs() }, [loadLiveLogs])
  useWsLogMerge(mode, wsLogs, processedWsLogsRef, liveBufferSize, setLogs)

  useEffect(() => {
    if (mode === 'static' && files.length === 0 && !filesLoading) void loadFiles()
  }, [files.length, filesLoading, loadFiles, mode])

  useEffect(() => {
    if (mode === 'static' && selectedFile) void loadFileLogs(selectedFile)
  }, [mode, selectedFile, loadFileLogs])

  const switchToLive = useCallback(() => { setMode('live'); void loadLiveLogs() }, [loadLiveLogs, setMode])
  const switchToStatic = useCallback(() => { setMode('static') }, [setMode])
  const handleFileChange = useCallback((value: string) => {
    setSelectedFile(value); setMode('static')
  }, [setMode, setSelectedFile])

  const dismissError = useCallback(() => setInlineError(null), [setInlineError])

  return {
    mode, wsConnected, logs, loading, filesLoading, refreshing,
    files, selectedFile, switchToLive, switchToStatic,
    handleRefresh, handleClearLive, handleFileChange,
    inlineError, dismissError,
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
    if (wsLogs.length < processedRef.current) processedRef.current = 0
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
  const scopedProfile = String(opts.profileName || '').trim().toLowerCase()

  return logs.filter((log) => {
    if (opts.workflowId) {
      const logWfId = String(log.workflowId || '').trim()
      if (!logWfId || logWfId !== opts.workflowId) return false
    }
    if (scopedProfile) {
      const logProfile = String(log.profileName || '').trim().toLowerCase()
      if (!logProfile || logProfile !== scopedProfile) return false
    }
    if (opts.levelFilter !== 'all' && String(log.level || '').toLowerCase() !== opts.levelFilter) return false
    if (opts.feedDebugOnly && !isFeedDebugMessage(String(log.message || ''))) return false
    if (!q) return true
    return matchesQuery(log, q)
  })
}

function matchesQuery(log: LogEntry, q: string): boolean {
  const fields = [
    log.message, log.source, log.profileName, log.taskId,
    log.targetUsername, log.errorCode, log.outcome, log.diagnostics,
  ]
  return fields.some((f) => String(f || '').toLowerCase().includes(q))
}
