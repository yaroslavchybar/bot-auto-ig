import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '@/lib/logs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { RefreshCw, AlignLeft } from 'lucide-react'
import {
  LevelAppearance,
  isFeedDebugMessage,
  LOGS_PAGE_SIZE,
  type LogLevel,
} from './useLogsState'

interface LogsEntryListProps {
  visibleLogs: LogEntry[]
  filteredLogs: LogEntry[]
  hasMoreLogs: boolean
  loading: boolean
  autoScroll: boolean
  showTime: boolean
  showSource: boolean
  showProfile: boolean
  onLoadMore: () => void
}

export function LogsEntryList({
  visibleLogs,
  filteredLogs,
  hasMoreLogs,
  loading,
  autoScroll,
  showTime,
  showSource,
  showProfile,
  onLoadMore,
}: LogsEntryListProps) {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const [showLoadMore, setShowLoadMore] = useState(false)

  // Detect scroll-to-top to show "load more"
  useEffect(() => {
    const root = scrollAreaRef.current
    const viewport = root?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLDivElement | null
    if (!viewport) return

    const onScroll = () => {
      const atTop = viewport.scrollTop <= 8
      setShowLoadMore(atTop && hasMoreLogs)
    }

    onScroll()
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [hasMoreLogs])

  // Auto-scroll to bottom
  useEffect(() => {
    if (!autoScroll) return
    const root = scrollAreaRef.current
    const viewport = root?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLDivElement | null
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [filteredLogs.length, autoScroll])

  return (
    <div className="border-line-soft relative mx-1 mb-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border bg-transparent shadow-xs">
      <TableHeader
        showTime={showTime}
        showProfile={showProfile}
        showSource={showSource}
      />

      <ScrollArea
        ref={scrollAreaRef}
        className="flex min-h-0 flex-1 bg-transparent font-mono text-[11px] leading-[1.3] select-text"
      >
        <ScrollContent
          loading={loading}
          visibleLogs={visibleLogs}
          filteredLogs={filteredLogs}
          hasMoreLogs={hasMoreLogs}
          showLoadMore={showLoadMore}
          showTime={showTime}
          showProfile={showProfile}
          showSource={showSource}
          onLoadMore={onLoadMore}
        />
      </ScrollArea>
    </div>
  )
}

function ScrollContent({
  loading,
  visibleLogs,
  filteredLogs,
  hasMoreLogs,
  showLoadMore,
  showTime,
  showProfile,
  showSource,
  onLoadMore,
}: {
  loading: boolean
  visibleLogs: LogEntry[]
  filteredLogs: LogEntry[]
  hasMoreLogs: boolean
  showLoadMore: boolean
  showTime: boolean
  showProfile: boolean
  showSource: boolean
  onLoadMore: () => void
}) {
  if (loading && visibleLogs.length === 0) {
    return (
      <div className="text-subtle-copy flex items-center justify-center p-4 font-sans italic">
        <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Fetching stream...
      </div>
    )
  }
  if (visibleLogs.length === 0) {
    return (
      <div className="text-subtle-copy flex items-center justify-center p-4 font-sans">
        No matching records found.
      </div>
    )
  }
  return (
    <div className="flex flex-col pb-4">
      {showLoadMore && hasMoreLogs && (
        <LoadMoreBanner
          remaining={filteredLogs.length - visibleLogs.length}
          onLoadMore={onLoadMore}
        />
      )}
      {visibleLogs.map((entry, idx) => (
        <LogEntryRow
          key={`${entry.ts}-${idx}`}
          entry={entry}
          showTime={showTime}
          showProfile={showProfile}
          showSource={showSource}
        />
      ))}
    </div>
  )
}

function TableHeader({
  showTime,
  showProfile,
  showSource,
}: {
  showTime: boolean
  showProfile: boolean
  showSource: boolean
}) {
  return (
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
  )
}

function LoadMoreBanner({
  remaining,
  onLoadMore,
}: {
  remaining: number
  onLoadMore: () => void
}) {
  return (
    <div className="bg-panel/95 border-line-soft sticky top-0 z-10 flex justify-center border-b py-1">
      <Button
        variant="outline"
        size="sm"
        onClick={onLoadMore}
        className="border-line bg-field hover:bg-panel-hover h-5 rounded-[3px] px-2 py-0 text-[10px] text-copy shadow-none transition-none hover:text-ink"
      >
        Load {Math.min(LOGS_PAGE_SIZE, remaining)} older logs ({remaining} left)
      </Button>
    </div>
  )
}

function LogEntryRow({
  entry,
  showTime,
  showProfile,
  showSource,
}: {
  entry: LogEntry
  showTime: boolean
  showProfile: boolean
  showSource: boolean
}) {
  const isFeedDebug = isFeedDebugMessage(String(entry.message || ''))
  const levelKey = (String(entry.level || '').toLowerCase() ||
    'info') as LogLevel | string
  const appearance = LevelAppearance[levelKey] || LevelAppearance.info
  const severityString = (entry.level || 'INFO').toUpperCase()

  return (
    <div
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
          <span className="truncate">{entry.profileName || '-'}</span>
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

      <div className="flex-1 px-2 py-0.5">
        <div
          className={`break-words whitespace-pre-wrap ${appearance.text} ${isFeedDebug ? 'text-status-info font-medium' : ''}`}
        >
          {entry.message}
        </div>
        <LogEntryMeta entry={entry} />
      </div>
    </div>
  )
}

function LogEntryMeta({ entry }: { entry: LogEntry }) {
  const hasMeta =
    Boolean(entry.taskId) ||
    Boolean(entry.targetUsername) ||
    Boolean(entry.errorCode) ||
    Boolean(entry.outcome) ||
    typeof entry.attempt === 'number' ||
    Boolean(entry.diagnostics)

  if (!hasMeta) return null

  return (
    <div className="text-subtle-copy mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
      {entry.taskId && <span>task: {entry.taskId}</span>}
      {entry.targetUsername && <span>target: @{entry.targetUsername}</span>}
      {entry.errorCode && <span>code: {entry.errorCode}</span>}
      {entry.outcome && <span>outcome: {entry.outcome}</span>}
      {typeof entry.attempt === 'number' && (
        <span>attempt: {entry.attempt}</span>
      )}
      {entry.diagnostics && (
        <span className="basis-full break-all">
          diagnostics: {entry.diagnostics}
        </span>
      )}
    </div>
  )
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
  } catch {
    return ''
  }
}
