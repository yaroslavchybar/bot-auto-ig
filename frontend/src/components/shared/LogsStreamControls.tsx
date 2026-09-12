import { Button } from '@/components/ui/button'
import {
  RefreshCw,
  Trash2,
} from 'lucide-react'

interface LogsStreamControlsProps {
  wsConnected: boolean
  loading: boolean
  refreshing: boolean
  onRefresh: () => void
  onClearLive: () => void
}

export function LogsStreamControls({
  wsConnected,
  loading,
  refreshing,
  onRefresh,
  onClearLive,
}: LogsStreamControlsProps) {
  return (
    <div className="border-line-soft flex flex-col justify-between gap-2 border-b px-2 py-1.5 sm:flex-row sm:items-center sm:gap-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          onClick={() => void onRefresh()}
          aria-label="Refresh logs"
          title="Refresh logs"
          className="h-8 w-8 shrink-0 p-0"
          disabled={loading || refreshing}
        >
          <RefreshCw
            className={
              loading || refreshing
                ? 'h-4 w-4 animate-spin'
                : 'h-4 w-4'
            }
          />
          <span className="sr-only">Refresh</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void onClearLive()}
          disabled={loading}
          className="border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] text-status-danger shadow-none transition-none hover:border-status-danger-border hover:bg-status-danger-soft hover:text-status-danger"
        >
          <Trash2 className="mr-1.5 h-3 w-3" />
          Clear
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <ConnectionStatus connected={wsConnected} />
      </div>
    </div>
  )
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className="text-muted-copy flex items-center gap-1.5 text-[11px] font-medium">
      <div
        className={`h-2 w-2 rounded-full ${connected ? 'status-dot-success-tight' : 'status-dot-danger'}`}
      />
      {connected ? 'Connected (WebSocket)' : 'Disconnected'}
    </div>
  )
}
