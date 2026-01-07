import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import type { LogEntry } from '../profiles/types'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RefreshCw, Trash2, FileText, Filter, Clock, Layers, ArrowDownToLine } from 'lucide-react'

type LogsMode = 'live' | 'static'

type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'all'

type LogFileItem = {
  label: string
  value: string
}

const LevelColorClass: Record<LogLevel | string, string> = {
  info: 'text-muted-foreground',
  warn: 'text-yellow-500',
  error: 'text-red-500',
  success: 'text-green-500',
  all: '',
}

export function LogsPage() {
  const [mode, setMode] = useState<LogsMode>('live')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filesLoading, setFilesLoading] = useState(false)
  const [files, setFiles] = useState<LogFileItem[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const [filterQuery, setFilterQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel>('all')
  const [showTime, setShowTime] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const [error, setError] = useState<string | null>(null)

  // WebSocket for real-time log streaming
  const { logs: wsLogs, connected: wsConnected } = useWebSocket()

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
    setLogs(prev => {
      const combined = [...prev, ...wsLogs.filter(
        wsLog => !prev.some(p => p.ts === wsLog.ts && p.message === wsLog.message)
      )]
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
    return logs.filter((log) => {
      if (levelFilter !== 'all' && String(log.level || '').toLowerCase() !== levelFilter) {
        return false
      }
      if (!q) return true
      const msg = String(log.message || '').toLowerCase()
      const src = String(log.source || '').toLowerCase()
      return msg.includes(q) || src.includes(q)
    })
  }, [logs, filterQuery, levelFilter])

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

  const levelBadge = (level: string) => {
    const key = (String(level || '').toLowerCase() || 'info') as LogLevel | string
    const colorClass = LevelColorClass[key] || LevelColorClass.info
    return (
      <span className={`uppercase text-[10px] tracking-wide ${colorClass}`}>
        {level || 'info'}
      </span>
    )
  }

  const formatTime = (ts: number) => {
    try {
      return new Date(ts).toLocaleTimeString()
    } catch {
      return ''
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-2xl font-bold tracking-tight">Logs</h2>
        <div className="flex items-center gap-2">
          <Button
            variant={mode === 'live' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setMode('live')
              void loadLiveLogs()
            }}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading && mode === 'live' ? 'animate-spin' : ''}`}
            />
            Live {wsConnected && <span className="ml-1 h-2 w-2 rounded-full bg-green-500 inline-block" />}
          </Button>
          <Button
            variant={mode === 'static' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('static')}
            disabled={files.length === 0}
          >
            <FileText className="mr-2 h-4 w-4" />
            Files
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadFiles()}
            disabled={filesLoading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${filesLoading ? 'animate-spin' : ''}`} />
            Refresh files
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleClearLive()}
            disabled={loading || mode !== 'live'}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Clear live
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive text-sm border-b border-destructive/20">
          {error}
        </div>
      )}

      <div className="flex-1 p-4 flex flex-col gap-4 bg-muted/10">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by message or source..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-64"
            />
          </div>

          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LogLevel)}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="success">Success</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <Button
              variant={showTime ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowTime((v) => !v)}
            >
              Time
            </Button>
            <Button
              variant={showSource ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowSource((v) => !v)}
            >
              Source
            </Button>
          </div>

          {mode === 'live' && (
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="h-4 w-4 text-muted-foreground" />
              <Button
                variant={autoScroll ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoScroll((v) => !v)}
              >
                Auto scroll
              </Button>
            </div>
          )}

          {mode === 'static' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Log file</span>
              <Select
                value={selectedFile ?? undefined}
                onValueChange={handleFileChange}
                disabled={files.length === 0}
              >
                <SelectTrigger className="w-72">
                  <SelectValue placeholder={files.length === 0 ? 'No log files' : 'Select log file'} />
                </SelectTrigger>
                <SelectContent>
                  {files.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <Card className="flex-1 flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base font-medium">
              {mode === 'live' ? 'Live logs' : 'Log file view'}
            </CardTitle>
            <Badge variant="outline" className="text-[11px]">
              {mode === 'live' ? 'LIVE' : selectedFile || 'STATIC'}
            </Badge>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
            <ScrollArea
              ref={scrollAreaRef}
              className="h-full rounded-b-xl border-t bg-muted/40 p-3 font-mono text-xs"
            >
              {loading && filteredLogs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Loading logs...
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No logs found
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredLogs.map((entry, idx) => (
                    <div
                      key={`${entry.ts}-${idx}`}
                      className="break-all whitespace-pre-wrap flex gap-2"
                    >
                      {showTime && (
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(entry.ts)}
                        </span>
                      )}
                      {showSource && entry.source && (
                        <span className="text-[10px] text-blue-400">
                          [{entry.source}]
                        </span>
                      )}
                      {levelBadge(entry.level)}
                      <span>{entry.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

