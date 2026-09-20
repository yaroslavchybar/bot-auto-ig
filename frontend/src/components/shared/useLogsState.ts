import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { mergeLogs, type LogEntry } from '@/lib/logs'
import { parseLogEntry, useWebSocket } from '@/hooks/useWebSocket'
import { useIsMobile } from '@/hooks/use-mobile'
import { useErrorHandler } from '@/hooks/useErrorHandler'

export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug' | 'all'

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
  automationId?: string | null
  profileName?: string | null
}

export function useLogsState({
  automationId = null,
  profileName = null,
}: UseLogsStateOptions = {}) {
  const isMobile = useIsMobile()
  const liveBufferSize = isMobile ? 250 : 1000
  const { handleError } = useErrorHandler()

  const {
    wsConnected, logs, loading,
    handleClearLive,
    inlineError, dismissError,
  } = useLogsFetching(liveBufferSize, automationId, profileName, handleError)

  const {
    filteredLogs, visibleLogs, hasMoreLogs, loadMoreLogs,
    filterQuery, setFilterQuery, levelFilter, setLevelFilter,
    showTime, setShowTime, showSource, setShowSource,
    showProfile, setShowProfile, autoScroll, setAutoScroll,
    feedDebugOnly, setFeedDebugOnly,
  } = useLogsFiltering({ logs, automationId, profileName })

  return {
    wsConnected,
    logs, filteredLogs, visibleLogs, hasMoreLogs, loadMoreLogs,
    loading,
    handleClearLive,
    inlineError, dismissError,
    filterQuery, setFilterQuery, levelFilter, setLevelFilter,
    showTime, setShowTime, showSource, setShowSource,
    showProfile, setShowProfile, autoScroll, setAutoScroll,
    feedDebugOnly, setFeedDebugOnly,
  }
}

// One buffer owns both history and incoming events.
function useLogsFetching(
  liveBufferSize: number,
  automationId: string | null | undefined,
  profileName: string | null | undefined,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const { connected: wsConnected } = useWebSocket({
    automationId, profileName, topic: 'logs', pauseWhenHidden: true, eventsOnly: true,
    onEvent: event => {
      if (event.type !== 'log' || !event.message) return
      const entry = parseLogEntry(event, null)
      setLogs(current => mergeLogs(current, [entry], liveBufferSize))
    },
  })
  const loadHistory = useCallback(async () => {
    const version = ++requestVersion.current
    try {
      const history = await apiFetch<LogEntry[]>('/api/logs')
      if (version !== requestVersion.current) return
      setLogs(current => mergeLogs(history, current, liveBufferSize))
      setInlineError(null)
    } catch (error) {
      if (version === requestVersion.current) setInlineError(handleError(error, 'Load logs'))
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [handleError, liveBufferSize])
  useEffect(() => {
    void loadHistory()
  }, [loadHistory, wsConnected])
  const handleClearLive = useCallback(async () => {
    ++requestVersion.current
    setLoading(true)
    try {
      await apiFetch('/api/logs', { method: 'DELETE' })
      ++requestVersion.current
      setLogs([])
      setInlineError(null)
    } catch (error) { setInlineError(handleError(error, 'Clear logs')) }
    finally { setLoading(false) }
  }, [handleError])
  return {
    logs, wsConnected, loading,
    handleClearLive, inlineError,
    dismissError: () => setInlineError(null),
  }
}

// --- Filtering hook: filter state, visible logs, pagination ---

interface UseLogsFilteringOptions {
  logs: LogEntry[]
  automationId: string | null | undefined
  profileName: string | null | undefined
}

function useLogsFiltering({
  logs,
  automationId,
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
    () => filterLogs(logs, { automationId, profileName, levelFilter, feedDebugOnly, filterQuery }),
    [logs, filterQuery, levelFilter, feedDebugOnly, automationId, profileName],
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
  automationId: string | null | undefined
  profileName: string | null | undefined
  levelFilter: LogLevel
  feedDebugOnly: boolean
  filterQuery: string
}

function filterLogs(logs: LogEntry[], opts: FilterOptions): LogEntry[] {
  const q = opts.filterQuery.trim().toLowerCase()
  const scopedProfile = String(opts.profileName || '').trim().toLowerCase()

  return logs.filter((log) => {
    if (opts.automationId) {
      const logWfId = String(log.automationId || '').trim()
      if (!logWfId || logWfId !== opts.automationId) return false
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
