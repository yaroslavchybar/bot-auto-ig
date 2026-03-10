import { useState } from 'react'
import type { LogEntry } from '@/lib/logs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Check, Copy, RefreshCw, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProfileLogsProps {
  logs: LogEntry[]
  loading: boolean
  onRefresh: () => void
}

export function ProfileLogs({ logs, loading, onRefresh }: ProfileLogsProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (logs.length === 0) return
    const text = logs
      .map(
        (l) =>
          `[${new Date(l.ts).toLocaleTimeString()}] [${l.level.toUpperCase()}] ${l.message}`,
      )
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy logs:', err)
    }
  }

  return (
    <div className="flex h-full flex-col gap-0">
      <div className="border-line-soft bg-panel-subtle flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          {/* Header handled by dialog/sheet usually, but if needed here */}
        </div>
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={loading || logs.length === 0}
            className="text-muted-copy hover:bg-panel-muted h-8 text-xs hover:text-ink"
          >
            {copied ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy Output
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh logs"
            title="Refresh logs"
            className="h-8 w-8 shrink-0 p-0"
          >
            <RefreshCw
              className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
            />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </div>

      <div className="bg-shell text-copy min-h-0 flex-1 overflow-hidden font-mono text-[11px] leading-relaxed">
        <ScrollArea className="h-full">
          <div className="p-4">
            {loading && logs.length === 0 ? (
              <div className="text-subtle-copy flex animate-pulse items-center gap-2">
                <Terminal className="h-3 w-3" />
                <span>Initializing log stream...</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-subtle-copy italic">
                No activity recorded.
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {logs
                  .slice()
                  .reverse()
                  .map((entry, idx) => (
                    <div
                      key={`${entry.ts}-${idx}`}
                      className="hover:bg-panel-muted -mx-4 flex gap-3 px-4 py-0.5 break-all whitespace-pre-wrap opacity-90 hover:opacity-100"
                    >
                      <span className="text-subtle-copy w-[60px] shrink-0 select-none">
                        {new Date(entry.ts).toLocaleTimeString([], {
                          hour12: false,
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <span
                        className={cn(
                          'w-[40px] shrink-0 pt-0.5 text-[10px] font-bold tracking-wider uppercase select-none',
                          entry.level === 'error'
                            ? 'text-status-danger'
                            : entry.level === 'warn'
                              ? 'text-status-warning'
                              : 'text-subtle-copy',
                        )}
                      >
                        {entry.level}
                      </span>
                      <span className="text-copy">{entry.message}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}



