import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { LogEntry } from '@/lib/logs'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  RefreshCw,
  Trash2,
  Filter,
  Clock,
  ArrowDownToLine,
  Bug,
  Terminal,
  Database,
  Hash,
  AlignLeft,
  History,
  Type,
} from 'lucide-react'

type LogsMode = 'live' | 'static'

type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug' | 'all'

type LogFileItem = {
  label: string
  value: string
}

const LevelAppearance: Record<LogLevel | string, { text: string; bg: string }> =
  {
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

const FEED_DEBUG_TAGS = ['[feed-like-debug]', '[feed-scroll-debug]'] as const
const LOGS_PAGE_SIZE = 30

const isFeedDebugMessage = (message: string) => {
  const lowered = String(message || '').toLowerCase()
  return FEED_DEBUG_TAGS.some((tag) => lowered.includes(tag))
}

interface LogsViewerProps {
  className?: string
  workflowId?: string | null
  profileName?: string | null
}

export function LogsViewer({
  className,
  workflowId = null,
  profileName = null,
}: LogsViewerProps) {
  const isMobile = useIsMobile()
  const liveBufferSize = isMobile ? 250 : 1000
  const [mode, setMode] = useState<LogsMode>('live')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filesLoading, setFilesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [files, setFiles] = useState<LogFileItem[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const [filterQuery, setFilterQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel>('all')
  const [showTime, setShowTime] = useState(true)
  const [showSource, setShowSource] = useState(false)
  const [showProfile, setShowProfile] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [feedDebugOnly, setFeedDebugOnly] = useState(false)
  const [visibleCount, setVisibleCount] = useState(LOGS_PAGE_SIZE)
  const [showLoadMore, setShowLoadMore] = useState(false)

  const [error, setError] = useState<string | null>(null)

  // WebSocket for real-time log streaming
  const { logs: wsLogs, connected: wsConnected } = useWebSocket({
    workflowId,
    enabled: mode === 'live',
    pauseWhenHidden: true,
    maxBuffer: liveBufferSize,
  })

  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
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
    const nextSelectedFile = selectedFile
      ? items.find((item) => item.value === selectedFile)?.value ?? null
      : (items[0]?.value ?? null)

    if (!nextSelectedFile) {
      setSelectedFile(null)
      setLogs([])
      return
    }

    if (nextSelectedFile !== selectedFile) {
      setSelectedFile(nextSelectedFile)
      return
    }

    await loadFileLogs(nextSelectedFile)
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

  useEffect(() => {
    void loadLiveLogs()
  }, [loadLiveLogs])

  // Update logs from WebSocket in live mode
  useEffect(() => {
    if (mode !== 'live') return
    if (wsLogs.length < processedWsLogsRef.current) {
      processedWsLogsRef.current = 0
    }

    const newEntries = wsLogs.slice(processedWsLogsRef.current)
    if (newEntries.length === 0) return

    processedWsLogsRef.current = wsLogs.length

    setLogs((prev) => {
      const seen = new Set(prev.map((entry) => `${entry.ts}-${entry.message}`))
      const appended = [...prev]

      for (const w of newEntries) {
        const key = `${w.ts}-${w.message}`
        if (!seen.has(key)) {
          seen.add(key)
          appended.push({
            ...w,
            profileName: w.profileName || undefined,
          })
        }
      }

      return appended.slice(-liveBufferSize)
    })
  }, [liveBufferSize, mode, wsLogs])

  useEffect(() => {
    if (mode === 'static' && files.length === 0 && !filesLoading) {
      void loadFiles()
    }
  }, [files.length, filesLoading, loadFiles, mode])

  useEffect(() => {
    if (mode === 'static' && selectedFile) {
      void loadFileLogs(selectedFile)
    }
  }, [mode, selectedFile, loadFileLogs])

  const filteredLogs = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    const scopedProfile = String(profileName || '')
      .trim()
      .toLowerCase()
    return logs.filter((log) => {
      if (workflowId) {
        const logWorkflowId = String(log.workflowId || '').trim()
        if (!logWorkflowId || logWorkflowId !== workflowId) {
          return false
        }
      }
      if (scopedProfile) {
        const logProfile = String(log.profileName || '')
          .trim()
          .toLowerCase()
        if (!logProfile || logProfile !== scopedProfile) {
          return false
        }
      }
      if (
        levelFilter !== 'all' &&
        String(log.level || '').toLowerCase() !== levelFilter
      ) {
        return false
      }
      if (feedDebugOnly && !isFeedDebugMessage(String(log.message || ''))) {
        return false
      }
      if (!q) return true
      const msg = String(log.message || '').toLowerCase()
      const src = String(log.source || '').toLowerCase()
      const profile = String(log.profileName || '').toLowerCase()
      return msg.includes(q) || src.includes(q) || profile.includes(q)
    })
  }, [logs, filterQuery, levelFilter, feedDebugOnly, workflowId, profileName])

  const visibleLogs = useMemo(() => {
    return filteredLogs.slice(Math.max(filteredLogs.length - visibleCount, 0))
  }, [filteredLogs, visibleCount])

  const hasMoreLogs = visibleLogs.length < filteredLogs.length

  useEffect(() => {
    setVisibleCount(LOGS_PAGE_SIZE)
  }, [mode, selectedFile, filterQuery, levelFilter, feedDebugOnly])

  useEffect(() => {
    const root = scrollAreaRef.current
    const viewport = root?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLDivElement | null
    if (!viewport) return

    const onScroll = () => {
      const atTop = viewport.scrollTop <= 8
      setShowLoadMore(atTop && filteredLogs.length > visibleCount)
    }

    onScroll()
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [filteredLogs.length, visibleCount])

  useEffect(() => {
    if (!autoScroll) return
    const root = scrollAreaRef.current
    const viewport = root?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLDivElement | null
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [filteredLogs.length, autoScroll])

  const handleFileChange = (value: string) => {
    setSelectedFile(value)
    setMode('static')
  }

  const formatTime = (ts: number) => {
    try {
      const d = new Date(ts)
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
    } catch {
      return ''
    }
  }

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden bg-transparent font-sans text-xs select-none ${className || 'h-full'}`}
    >
      {/* Top Application Ribbon */}
      <div className="border-line-soft relative z-10 flex shrink-0 flex-col border-b bg-transparent shadow-xs">
        {/* Row 1: Main Controls & Connection State */}
        <div className="border-line-soft flex flex-col justify-between gap-2 border-b px-2 py-1.5 sm:flex-row sm:items-center sm:gap-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="bg-panel-subtle border-line-soft flex rounded-[4px] border p-0.5 shadow-inner">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMode('live')
                  void loadLiveLogs()
                }}
                className={`border-line bg-field h-6 w-20 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
                  mode === 'live'
                    ? 'border-line-strong bg-panel-hover text-ink font-medium'
                    : 'text-copy hover:bg-panel-hover hover:text-ink'
                }`}
                disabled={loading}
              >
                <Terminal className="mr-1.5 h-3 w-3" />
                Live
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode('static')}
                disabled={files.length === 0}
                className={`border-line bg-field h-6 w-20 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
                  mode === 'static'
                    ? 'border-line-strong bg-panel-hover text-ink font-medium'
                    : 'text-copy hover:bg-panel-hover hover:text-ink'
                }`}
              >
                <Database className="mr-1.5 h-3 w-3" />
                Archive
              </Button>
            </div>

            <div className="bg-panel-hover mx-1 h-4 w-px" />

            <Button
              variant="outline"
              size="icon"
              onClick={() => void handleRefresh()}
              aria-label="Refresh logs"
              title="Refresh logs"
              className="h-8 w-8 shrink-0 p-0"
              disabled={loading || filesLoading || refreshing}
            >
              <RefreshCw
                className={
                  loading || filesLoading || refreshing
                    ? 'h-4 w-4 animate-spin'
                    : 'h-4 w-4'
                }
              />
              <span className="sr-only">Refresh</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleClearLive()}
              disabled={loading || mode !== 'live'}
              className="border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] text-status-danger shadow-none transition-none hover:border-status-danger-border hover:bg-status-danger-soft hover:text-status-danger"
            >
              <Trash2 className="mr-1.5 h-3 w-3" />
              Clear
            </Button>
          </div>

          <div className="flex items-center gap-3">
            {mode === 'live' ? (
              <div className="text-muted-copy flex items-center gap-1.5 text-[11px] font-medium">
                <div
                  className={`h-2 w-2 rounded-full ${wsConnected ? 'status-dot-success-tight' : 'status-dot-danger'}`}
                />
                {wsConnected ? 'Connected (WebSocket)' : 'Disconnected'}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <History className="text-muted-copy h-3 w-3" />
                <Select
                  value={selectedFile ?? undefined}
                  onValueChange={handleFileChange}
                  disabled={files.length === 0}
                >
                  <SelectTrigger className="brand-focus border-line bg-field text-ink h-6 w-56 rounded-[3px] px-2 py-0 text-[11px] focus:ring-1">
                    <SelectValue
                      placeholder={
                        files.length === 0
                          ? 'No log archives'
                          : 'Select history log...'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {files.map((f) => (
                      <SelectItem
                        key={f.value}
                        value={f.value}
                        className="cursor-default py-1 text-[11px]"
                      >
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Filters and View Configuration */}
        <div className="flex flex-col justify-between gap-2 bg-transparent px-2 py-1 md:flex-row md:items-center md:gap-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex w-full items-center sm:w-auto">
              <Filter className="text-subtle-copy absolute left-1.5 h-3 w-3" />
              <Input
                placeholder="Filter output..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="brand-focus border-line bg-field text-ink h-6 w-full rounded-[3px] pl-6 text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 sm:w-48"
              />
            </div>

            <Select
              value={levelFilter}
              onValueChange={(v) => setLevelFilter(v as LogLevel)}
            >
              <SelectTrigger className="border-line bg-field text-ink h-6 w-28 rounded-[3px] px-2 py-0 text-[11px] focus:ring-0">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent className="bg-panel border-line text-ink">
                <SelectItem
                  value="all"
                  className="hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
                >
                  All Levels
                </SelectItem>
                <SelectItem
                  value="info"
                  className="text-status-info hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
                >
                  Info
                </SelectItem>
                <SelectItem
                  value="warn"
                  className="text-status-warning hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
                >
                  Warning
                </SelectItem>
                <SelectItem
                  value="error"
                  className="text-status-danger hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
                >
                  Error
                </SelectItem>
                <SelectItem
                  value="success"
                  className="text-status-success hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
                >
                  Success
                </SelectItem>
                <SelectItem
                  value="debug"
                  className="text-subtle-copy hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
                >
                  Debug
                </SelectItem>
              </SelectContent>
            </Select>

            <div className="bg-panel-hover mx-1 hidden h-3.5 w-px sm:block" />

            <div className="hidden items-center gap-1 sm:flex">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTime((v) => !v)}
                title="Toggle Time Column"
                className={`border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
                  showTime
                    ? 'border-line-strong bg-panel-hover text-ink font-medium'
                    : 'text-copy hover:bg-panel-hover hover:text-ink'
                }`}
              >
                <Clock className="mr-1 h-3 w-3" /> Time
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSource((v) => !v)}
                title="Toggle Source Column"
                className={`border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
                  showSource
                    ? 'border-line-strong bg-panel-hover text-ink font-medium'
                    : 'text-copy hover:bg-panel-hover hover:text-ink'
                }`}
              >
                <Hash className="mr-1 h-3 w-3" /> Source
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowProfile((v) => !v)}
                title="Toggle Profile Column"
                className={`border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
                  showProfile
                    ? 'border-line-strong bg-panel-hover text-ink font-medium'
                    : 'text-copy hover:bg-panel-hover hover:text-ink'
                }`}
              >
                <Type className="mr-1 h-3 w-3" /> Profile
              </Button>
            </div>

            <div className="bg-panel-hover mx-1 hidden h-3.5 w-px sm:block" />

            <Button
              variant="outline"
              size="sm"
              onClick={() => setFeedDebugOnly((v) => !v)}
              title="Filter UI feed-specific debug logic"
              className={`border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
                feedDebugOnly
                  ? 'border-line-strong bg-panel-hover text-ink font-medium'
                  : 'text-copy hover:bg-panel-hover hover:text-ink'
              }`}
            >
              <Bug
                className={`mr-1 h-3 w-3 ${feedDebugOnly ? 'text-status-warning' : 'text-subtle-copy'}`}
              />{' '}
              Feed Debug
            </Button>
          </div>

          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoScroll((v) => !v)}
              className={`border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
                autoScroll
                  ? 'border-line-strong bg-panel-hover text-ink font-medium'
                  : 'text-copy hover:bg-panel-hover hover:text-ink'
              }`}
            >
              <ArrowDownToLine className="mr-1 h-3 w-3" />
              Auto-tail
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="status-banner-danger flex shrink-0 items-center border-b px-3 py-1.5 text-[11px] font-medium">
          <div className="status-dot-danger mr-2 h-2 w-2 rounded-full" />
          {error}
        </div>
      )}

      {/* Main Data Grid */}
      <div className="border-line-soft relative mx-1 mb-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border bg-transparent shadow-xs">
        {/* Table Header Row */}
        <div className="border-line-soft text-muted-copy flex hidden shrink-0 items-center border-b bg-transparent text-[10px] font-semibold uppercase select-none md:flex">
          {showTime && (
            <div className="hidden w-[100px] shrink-0 items-center border-r border-transparent px-2 py-1 sm:flex">
              Timestamp
            </div>
          )}
          {showProfile && (
            <div className="hidden w-[120px] shrink-0 items-center border-r border-transparent px-2 py-1 md:flex">
              Profile
            </div>
          )}
          {showSource && (
            <div className="hidden w-[110px] shrink-0 items-center border-r border-transparent px-2 py-1 lg:flex">
              Module
            </div>
          )}
          <div className="flex w-[70px] shrink-0 items-center border-r border-transparent px-2 py-1">
            Sev
          </div>
          <div className="flex flex-1 items-center gap-1.5 px-2 py-1">
            <AlignLeft className="text-subtle-copy h-3 w-3" />
            Message Payload
          </div>
        </div>

        {/* Scaled-down ScrollArea for absolute density */}
        <ScrollArea
          ref={scrollAreaRef}
          className="flex min-h-0 flex-1 bg-transparent font-mono text-[11px] leading-[1.3] select-text"
        >
          {loading && visibleLogs.length === 0 ? (
            <div className="text-subtle-copy flex items-center justify-center p-4 font-sans italic">
              <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Fetching
              stream...
            </div>
          ) : visibleLogs.length === 0 ? (
            <div className="text-subtle-copy flex items-center justify-center p-4 font-sans">
              No matching records found.
            </div>
          ) : (
            <div className="flex flex-col pb-4">
              {showLoadMore && hasMoreLogs && (
                <div className="bg-panel/95 border-line-soft sticky top-0 z-10 flex justify-center border-b py-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setVisibleCount((prev) =>
                        Math.min(prev + LOGS_PAGE_SIZE, filteredLogs.length),
                      )
                    }
                    className="border-line bg-field hover:bg-panel-hover h-5 rounded-[3px] px-2 py-0 text-[10px] text-copy shadow-none transition-none hover:text-ink"
                  >
                    Load{' '}
                    {Math.min(
                      LOGS_PAGE_SIZE,
                      filteredLogs.length - visibleLogs.length,
                    )}{' '}
                    older logs ({filteredLogs.length - visibleLogs.length} left)
                  </Button>
                </div>
              )}
              {visibleLogs.map((entry, idx) => {
                const isFeedDebug = isFeedDebugMessage(
                  String(entry.message || ''),
                )
                const levelKey = (String(entry.level || '').toLowerCase() ||
                  'info') as LogLevel | string
                const appearance =
                  LevelAppearance[levelKey] || LevelAppearance.info
                const severityString = (entry.level || 'INFO').toUpperCase()

                return (
                  <div
                    key={`${entry.ts}-${idx}`}
                    className={`border-line-soft flex items-start border-b ${appearance.bg} ${isFeedDebug ? 'bg-status-info-soft' : ''}`}
                    style={
                      appearance.bg.includes('border-l')
                        ? {}
                        : { borderLeft: '2px solid transparent' }
                    }
                  >
                    {showTime && (
                      <div className="text-subtle-copy hidden w-[100px] shrink-0 overflow-hidden border-r border-transparent px-2 py-0.5 text-[10px] text-ellipsis whitespace-nowrap sm:block">
                        {formatTime(entry.ts)}
                      </div>
                    )}

                    {showProfile && (
                      <div className="text-muted-copy hidden w-[120px] shrink-0 items-center overflow-hidden border-r border-transparent px-2 py-0.5 text-ellipsis whitespace-nowrap md:flex">
                        <span className="truncate">
                          {entry.profileName || '-'}
                        </span>
                      </div>
                    )}

                    {showSource && (
                      <div className="text-status-info/80 hidden w-[110px] shrink-0 overflow-hidden border-r border-transparent px-2 py-0.5 text-ellipsis whitespace-nowrap lg:block">
                        {entry.source || '-'}
                      </div>
                    )}

                    <div
                      className={`w-[70px] shrink-0 border-r border-transparent px-2 py-0.5 text-[10px] font-semibold ${appearance.text}`}
                    >
                      {severityString}
                    </div>

                    <div
                      className={`flex-1 px-2 py-0.5 break-words whitespace-pre-wrap ${appearance.text} ${isFeedDebug ? 'text-status-info font-medium' : ''}`}
                    >
                      {entry.message}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Bottom Status Bar */}
      <div className="border-line-soft text-subtle-copy flex h-auto min-h-[20px] shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-transparent px-2 py-1 text-[10px]">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            {visibleLogs.length}/{filteredLogs.length} Records
          </span>
          {filterQuery && <span>Filter active</span>}
          {levelFilter !== 'all' && (
            <span>Severity: {levelFilter.toUpperCase()}</span>
          )}
        </div>
        <div className="flex items-center">
          <span className="hidden sm:inline">
            Mode: {mode === 'live' ? 'Live Streaming' : 'Archival Exploration'}
          </span>
        </div>
      </div>
    </div>
  )
}


