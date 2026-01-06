import { useState } from 'react'
import type { LogEntry } from './types'
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { RefreshCw, ArrowLeft, Copy, Check } from "lucide-react"

interface ProfileLogsProps {
  logs: LogEntry[]
  loading: boolean
  onRefresh: () => void
  onBack?: () => void
}

export function ProfileLogs({ logs, loading, onRefresh, onBack }: ProfileLogsProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (logs.length === 0) return
    const text = logs.map(l => `[${new Date(l.ts).toLocaleTimeString()}] [${l.level.toUpperCase()}] ${l.message}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy logs:', err)
    }
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} title="Back to Details">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <h3 className="text-lg font-medium">Activity Logs</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={loading || logs.length === 0}
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 border rounded-md bg-muted/50 p-4 font-mono text-xs">
        <ScrollArea className="h-full">
          {loading && logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">No logs found</div>
          ) : (
            <div className="flex flex-col gap-1">
              {logs.slice().reverse().map((entry, idx) => (
                <div key={`${entry.ts}-${idx}`} className="break-all whitespace-pre-wrap">
                  <span className="text-muted-foreground">[{new Date(entry.ts).toLocaleTimeString()}]</span>{' '}
                  <span className={entry.level === 'error' ? 'text-red-500' : entry.level === 'warn' ? 'text-yellow-500' : ''}>
                    [{entry.level.toUpperCase()}]
                  </span>{' '}
                  {entry.message}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
