import { useState } from 'react'
import type { LogEntry } from './types'
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Check, Copy, RefreshCw, Terminal } from "lucide-react"
import { cn } from "@/lib/utils"

interface ProfileLogsProps {
  logs: LogEntry[]
  loading: boolean
  onRefresh: () => void
}

export function ProfileLogs({ logs, loading, onRefresh }: ProfileLogsProps) {
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
    <div className="flex flex-col h-full gap-0">
      <div className="flex justify-between items-center p-4 border-b bg-muted/5">
        <div className="flex items-center gap-2">
          {/* Header handled by dialog/sheet usually, but if needed here */}
        </div>
        <div className="flex items-center gap-2 w-full justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={loading || logs.length === 0}
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copy Output
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-8 text-xs bg-background shadow-sm"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-zinc-950 text-zinc-50 font-mono text-[11px] leading-relaxed overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4">
            {loading && logs.length === 0 ? (
              <div className="flex items-center gap-2 text-zinc-500 animate-pulse">
                <Terminal className="h-3 w-3" />
                <span>Initializing log stream...</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-zinc-600 italic">No activity recorded.</div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {logs.slice().reverse().map((entry, idx) => (
                  <div key={`${entry.ts}-${idx}`} className="break-all whitespace-pre-wrap flex gap-3 opacity-90 hover:opacity-100 hover:bg-zinc-900/50 -mx-4 px-4 py-0.5">
                    <span className="text-zinc-500 shrink-0 w-[60px] select-none">
                      {new Date(entry.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className={cn(
                      "font-bold shrink-0 w-[40px] uppercase select-none text-[10px] pt-0.5 tracking-wider",
                      entry.level === 'error' ? "text-red-400" :
                        entry.level === 'warn' ? "text-yellow-400" :
                          "text-zinc-600"
                    )}>
                      {entry.level}
                    </span>
                    <span className="text-zinc-300">
                      {entry.message}
                    </span>
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
