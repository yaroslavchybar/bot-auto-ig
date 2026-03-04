import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { LogEntry } from '@/tabs/profiles/types'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RefreshCw, Trash2, Filter, Clock, ArrowDownToLine, Bug, Terminal, Database, Hash, AlignLeft, History, Type } from 'lucide-react'

type LogsMode = 'live' | 'static'

type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug' | 'all'

type LogFileItem = {
  label: string
  value: string
}

const LevelAppearance: Record<LogLevel | string, { text: string; bg: string }> = {
  info: { text: 'text-neutral-700 dark:text-neutral-300', bg: 'hover:bg-blue-50/50 dark:hover:bg-blue-900/10' },
  warn: { text: 'text-amber-600 dark:text-amber-400 font-medium', bg: 'bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-100/50 dark:hover:bg-amber-900/40' },
  error: { text: 'text-red-600 dark:text-red-400 font-semibold', bg: 'bg-red-50/80 dark:bg-red-950/30 hover:bg-red-100/80 dark:hover:bg-red-900/40 border-l-2 border-l-red-500' },
  success: { text: 'text-emerald-600 dark:text-emerald-400 font-medium', bg: 'bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/40' },
  debug: { text: 'text-neutral-500 dark:text-neutral-500', bg: 'hover:bg-neutral-100 dark:hover:bg-neutral-800/50' },
  all: { text: '', bg: '' },
}

const FEED_DEBUG_TAGS = ['[feed-like-debug]', '[feed-scroll-debug]'] as const
const LOGS_PAGE_SIZE = 30

const isFeedDebugMessage = (message: string) => {
  const lowered = String(message || '').toLowerCase()
  return FEED_DEBUG_TAGS.some((tag) => lowered.includes(tag))
}

function DenseButton({ active, className, children, ...props }: React.ComponentProps<typeof Button> & { active?: boolean }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-6 px-2 py-0 text-[11px] rounded-[3px] border-neutral-300 dark:border-neutral-600 font-sans shadow-none transition-none ${active ? 'bg-neutral-200 dark:bg-neutral-700 border-neutral-400 dark:border-neutral-500 font-medium text-neutral-900 dark:text-white' : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'} ${className}`}
      {...props}
    >
      {children}
    </Button>
  )
}

interface LogsViewerProps {
  className?: string
  workflowId?: string | null
  profileName?: string | null
}

export function LogsViewer({ className, workflowId = null, profileName = null }: LogsViewerProps) {
  const [mode, setMode] = useState<LogsMode>('live')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filesLoading, setFilesLoading] = useState(false)
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
  const { logs: wsLogs, connected: wsConnected } = useWebSocket({ workflowId })

  const scrollAreaRef = useRef<HTMLDivElement | null>(null)

  const loadLiveLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<LogEntry[]>('/api/logs')
      setLogs(data.slice(-1000))
      setMode('live')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
        const data = await apiFetch<LogEntry[]>(`/api/logs/file/${encodeURIComponent(filename)}`)
        setLogs(data.slice(-1000))
        setMode('static')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    []
  )

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
    void loadFiles()
  }, [loadLiveLogs, loadFiles])

  // Update logs from WebSocket in live mode
  useEffect(() => {
    if (mode !== 'live') return
    // Merge WebSocket logs with existing logs, keeping only latest 1000
    setLogs((prev) => {
      // Use a Set based on timestamp + message to deduplicate
      const seen = new Set<string>()
      const combined: LogEntry[] = []

      // Add previous logs first
      for (const p of prev) {
        const key = `${p.ts}-${p.message}`
        if (!seen.has(key)) {
          seen.add(key)
          combined.push(p)
        }
      }

      // Add new incoming WebSocket logs
      for (const w of wsLogs) {
        const key = `${w.ts}-${w.message}`
        if (!seen.has(key)) {
          seen.add(key)
          combined.push({
            ...w,
            profileName: w.profileName || undefined,
          } as LogEntry)
        } else {
          if (w.profileName) {
            const existing = combined.find((p) => p.ts === w.ts && p.message === w.message)
            if (existing && !existing.profileName) {
              existing.profileName = w.profileName
            }
          }
        }
      }

      combined.sort((a, b) => a.ts - b.ts)
      return combined.slice(-1000)
    })
  }, [mode, wsLogs])

  useEffect(() => {
    if (mode === 'static' && selectedFile) {
      void loadFileLogs(selectedFile)
    }
  }, [mode, selectedFile, loadFileLogs])

  const filteredLogs = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    const scopedProfile = String(profileName || '').trim().toLowerCase()
    return logs.filter((log) => {
      if (workflowId) {
        const logWorkflowId = String((log as any).workflowId || '').trim()
        if (!logWorkflowId || logWorkflowId !== workflowId) {
          return false
        }
      }
      if (scopedProfile) {
        const logProfile = String(log.profileName || '').trim().toLowerCase()
        if (!logProfile || logProfile !== scopedProfile) {
          return false
        }
      }
      if (levelFilter !== 'all' && String(log.level || '').toLowerCase() !== levelFilter) {
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
    const viewport = root?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null
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
    const viewport = root?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null
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
    <div className={`flex min-h-0 flex-col bg-neutral-200 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 font-sans text-xs overflow-hidden select-none ${className || 'h-full'}`}>

      {/* Top Application Ribbon */}
      <div className="flex flex-col bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 shrink-0 shadow-sm">

        {/* Row 1: Main Controls & Connection State */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-2 py-1.5 border-b border-neutral-200 dark:border-neutral-700/50 gap-2 sm:gap-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex bg-neutral-200/50 dark:bg-neutral-900/50 p-0.5 rounded-[4px] border border-neutral-300/50 dark:border-neutral-700/50 shadow-inner">
              <DenseButton
                active={mode === 'live'}
                onClick={() => {
                  setMode('live')
                  void loadLiveLogs()
                }}
                className="w-20"
                disabled={loading}
              >
                <Terminal className="mr-1.5 h-3 w-3" />
                Live
              </DenseButton>
              <DenseButton
                active={mode === 'static'}
                onClick={() => setMode('static')}
                disabled={files.length === 0}
                className="w-20"
              >
                <Database className="mr-1.5 h-3 w-3" />
                Archive
              </DenseButton>
            </div>

            <div className="w-px h-4 bg-neutral-300 dark:bg-neutral-600 mx-1" />

            <DenseButton onClick={mode === 'live' ? () => void loadLiveLogs() : () => void loadFiles()} disabled={loading || filesLoading}>
              <RefreshCw className={`mr-1.5 h-3 w-3 ${(loading || filesLoading) ? 'animate-spin' : ''}`} />
              Refresh
            </DenseButton>

            <DenseButton onClick={() => void handleClearLive()} disabled={loading || mode !== 'live'} className="text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-800">
              <Trash2 className="mr-1.5 h-3 w-3" />
              Clear
            </DenseButton>
          </div>

          <div className="flex items-center gap-3">
            {mode === 'live' ? (
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                {wsConnected ? 'Connected (WebSocket)' : 'Disconnected'}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <History className="h-3 w-3 text-neutral-500" />
                <Select value={selectedFile ?? undefined} onValueChange={handleFileChange} disabled={files.length === 0}>
                  <SelectTrigger className="h-6 text-[11px] w-56 rounded-[3px] border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 focus:ring-0 focus:ring-offset-0 px-2 py-0">
                    <SelectValue placeholder={files.length === 0 ? 'No log archives' : 'Select history log...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {files.map((f) => (
                      <SelectItem key={f.value} value={f.value} className="text-[11px] py-1 cursor-default">
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
        <div className="flex flex-col md:flex-row md:items-center justify-between px-2 py-1 bg-white/50 dark:bg-neutral-900/20 gap-2 md:gap-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center w-full sm:w-auto">
              <Filter className="absolute left-1.5 h-3 w-3 text-neutral-400" />
              <Input
                placeholder="Filter output..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="w-full sm:w-48 h-6 pl-6 text-[11px] rounded-[3px] border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
              />
            </div>

            <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LogLevel)}>
              <SelectTrigger className="w-28 h-6 text-[11px] rounded-[3px] border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 focus:ring-0 px-2 py-0">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-[11px] py-1">All Levels</SelectItem>
                <SelectItem value="info" className="text-[11px] py-1 text-blue-600 dark:text-blue-400">Info</SelectItem>
                <SelectItem value="warn" className="text-[11px] py-1 text-amber-600 dark:text-amber-500">Warning</SelectItem>
                <SelectItem value="error" className="text-[11px] py-1 text-red-600 dark:text-red-500">Error</SelectItem>
                <SelectItem value="success" className="text-[11px] py-1 text-emerald-600 dark:text-emerald-500">Success</SelectItem>
                <SelectItem value="debug" className="text-[11px] py-1 text-neutral-500">Debug</SelectItem>
              </SelectContent>
            </Select>

            <div className="hidden sm:block w-px h-3.5 bg-neutral-300 dark:bg-neutral-600 mx-1" />

            <div className="hidden sm:flex items-center gap-1">
              <DenseButton active={showTime} onClick={() => setShowTime((v) => !v)} title="Toggle Time Column">
                <Clock className="h-3 w-3 mr-1" /> Time
              </DenseButton>
              <DenseButton active={showSource} onClick={() => setShowSource((v) => !v)} title="Toggle Source Column">
                <Hash className="h-3 w-3 mr-1" /> Source
              </DenseButton>
              <DenseButton active={showProfile} onClick={() => setShowProfile((v) => !v)} title="Toggle Profile Column">
                <Type className="h-3 w-3 mr-1" /> Profile
              </DenseButton>
            </div>

            <div className="hidden sm:block w-px h-3.5 bg-neutral-300 dark:bg-neutral-600 mx-1" />

            <DenseButton active={feedDebugOnly} onClick={() => setFeedDebugOnly((v) => !v)} title="Filter UI feed-specific debug logic">
              <Bug className={`h-3 w-3 mr-1 ${feedDebugOnly ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-500'}`} /> Feed Debug
            </DenseButton>
          </div>

          <div>
            <DenseButton active={autoScroll} onClick={() => setAutoScroll((v) => !v)}>
              <ArrowDownToLine className="mr-1 h-3 w-3" />
              Auto-tail
            </DenseButton>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-3 py-1.5 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-b border-red-200 dark:border-red-900/50 text-[11px] font-medium shrink-0 flex items-center">
          <div className="w-2 h-2 rounded-full bg-red-500 mr-2" />
          {error}
        </div>
      )}

      {/* Main Data Grid */}
      <div className="flex min-h-0 flex-1 overflow-hidden flex-col bg-white dark:bg-[#121212] m-1 rounded-[3px] border border-neutral-300 dark:border-neutral-700 shadow-sm relative">

        {/* Table Header Row */}
        <div className="flex items-center bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 text-[10px] uppercase font-semibold text-neutral-500 dark:text-neutral-400 shrink-0 select-none">
          {showTime && (
            <div className="hidden sm:flex w-[100px] shrink-0 border-r border-neutral-300 dark:border-neutral-700 px-2 py-1 items-center">
              Timestamp
            </div>
          )}
          {showProfile && (
            <div className="hidden md:flex w-[120px] shrink-0 border-r border-neutral-300 dark:border-neutral-700 px-2 py-1 items-center">
              Profile
            </div>
          )}
          {showSource && (
            <div className="hidden lg:flex w-[110px] shrink-0 border-r border-neutral-300 dark:border-neutral-700 px-2 py-1 items-center">
              Module
            </div>
          )}
          <div className="w-[70px] shrink-0 border-r border-neutral-300 dark:border-neutral-700 px-2 py-1 flex items-center">
            Sev
          </div>
          <div className="flex-1 px-2 py-1 flex items-center gap-1.5">
            <AlignLeft className="w-3 h-3 text-neutral-400" />
            Message Payload
          </div>
        </div>

        {/* Scaled-down ScrollArea for absolute density */}
        <ScrollArea
          ref={scrollAreaRef}
          className="flex min-h-0 flex-1 font-mono text-[11px] leading-[1.3] bg-white dark:bg-[#121212] select-text"
        >
          {loading && visibleLogs.length === 0 ? (
            <div className="flex items-center justify-center p-4 text-neutral-500 font-sans italic">
              <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Fetching stream...
            </div>
          ) : visibleLogs.length === 0 ? (
            <div className="flex items-center justify-center p-4 text-neutral-500 font-sans">
              No matching records found.
            </div>
          ) : (
            <div className="flex flex-col pb-4">
              {showLoadMore && hasMoreLogs && (
                <div className="sticky top-0 z-10 flex justify-center py-1 bg-white/95 dark:bg-[#121212]/95 border-b border-neutral-200 dark:border-neutral-800">
                  <DenseButton
                    onClick={() => setVisibleCount((prev) => Math.min(prev + LOGS_PAGE_SIZE, filteredLogs.length))}
                    className="h-5 px-2 text-[10px]"
                  >
                    Load {Math.min(LOGS_PAGE_SIZE, filteredLogs.length - visibleLogs.length)} older logs ({filteredLogs.length - visibleLogs.length} left)
                  </DenseButton>
                </div>
              )}
              {visibleLogs.map((entry, idx) => {
                const isFeedDebug = isFeedDebugMessage(String(entry.message || ''))
                const levelKey = (String(entry.level || '').toLowerCase() || 'info') as LogLevel | string
                const appearance = LevelAppearance[levelKey] || LevelAppearance.info
                const severityString = (entry.level || 'INFO').toUpperCase()

                return (
                  <div
                    key={`${entry.ts}-${idx}`}
                    className={`flex items-start border-b border-neutral-100 dark:border-neutral-800/60 ${appearance.bg} ${isFeedDebug ? 'bg-indigo-50/30 dark:bg-indigo-950/20' : ''}`}
                    style={appearance.bg.includes('border-l') ? {} : { borderLeft: '2px solid transparent' }}
                  >
                    {showTime && (
                      <div className="hidden sm:block w-[100px] shrink-0 px-2 py-0.5 text-[10px] text-neutral-500 dark:text-neutral-500 whitespace-nowrap overflow-hidden text-ellipsis border-r border-transparent">
                        {formatTime(entry.ts)}
                      </div>
                    )}

                    {showProfile && (
                      <div className="hidden md:flex w-[120px] shrink-0 px-2 py-0.5 text-neutral-600 dark:text-neutral-400 whitespace-nowrap overflow-hidden text-ellipsis items-center border-r border-transparent">
                        <span className="truncate">{entry.profileName || '-'}</span>
                      </div>
                    )}

                    {showSource && (
                      <div className="hidden lg:block w-[110px] shrink-0 px-2 py-0.5 text-blue-700/80 dark:text-blue-400/80 whitespace-nowrap overflow-hidden text-ellipsis border-r border-transparent">
                        {entry.source || '-'}
                      </div>
                    )}

                    <div className={`w-[70px] shrink-0 px-2 py-0.5 font-semibold text-[10px] border-r border-transparent ${appearance.text}`}>
                      {severityString}
                    </div>

                    <div className={`flex-1 px-2 py-0.5 break-words whitespace-pre-wrap ${appearance.text} ${isFeedDebug ? 'text-indigo-700 dark:text-indigo-400 font-medium' : ''}`}>
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
      <div className="h-auto min-h-[20px] shrink-0 bg-neutral-200 dark:bg-neutral-800 border-t border-neutral-300 dark:border-neutral-700 px-2 py-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
        <div className="flex flex-wrap items-center gap-3">
          <span>{visibleLogs.length}/{filteredLogs.length} Records</span>
          {filterQuery && <span>Filter active</span>}
          {levelFilter !== 'all' && <span>Severity: {levelFilter.toUpperCase()}</span>}
        </div>
        <div className="flex items-center">
          <span className="hidden sm:inline">Mode: {mode === 'live' ? 'Live Streaming' : 'Archival Exploration'}</span>
        </div>
      </div>
    </div>
  )
}
