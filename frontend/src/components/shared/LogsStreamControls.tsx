import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  RefreshCw,
  Trash2,
  Terminal,
  Database,
  History,
} from 'lucide-react'
import type { LogsMode, LogFileItem } from './useLogsState'

interface LogsStreamControlsProps {
  mode: LogsMode
  wsConnected: boolean
  loading: boolean
  filesLoading: boolean
  refreshing: boolean
  files: LogFileItem[]
  selectedFile: string | null
  onSwitchToLive: () => void
  onSwitchToStatic: () => void
  onRefresh: () => void
  onClearLive: () => void
  onFileChange: (value: string) => void
}

export function LogsStreamControls({
  mode,
  wsConnected,
  loading,
  filesLoading,
  refreshing,
  files,
  selectedFile,
  onSwitchToLive,
  onSwitchToStatic,
  onRefresh,
  onClearLive,
  onFileChange,
}: LogsStreamControlsProps) {
  return (
    <div className="border-line-soft flex flex-col justify-between gap-2 border-b px-2 py-1.5 sm:flex-row sm:items-center sm:gap-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <ModeToggle
          mode={mode}
          loading={loading}
          filesCount={files.length}
          onSwitchToLive={onSwitchToLive}
          onSwitchToStatic={onSwitchToStatic}
        />

        <div className="bg-panel-hover mx-1 h-4 w-px" />

        <Button
          variant="outline"
          size="icon"
          onClick={() => void onRefresh()}
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
          onClick={() => void onClearLive()}
          disabled={loading || mode !== 'live'}
          className="border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] text-status-danger shadow-none transition-none hover:border-status-danger-border hover:bg-status-danger-soft hover:text-status-danger"
        >
          <Trash2 className="mr-1.5 h-3 w-3" />
          Clear
        </Button>
      </div>

      <div className="flex items-center gap-3">
        {mode === 'live' ? (
          <ConnectionStatus connected={wsConnected} />
        ) : (
          <FileSelector
            files={files}
            selectedFile={selectedFile}
            onFileChange={onFileChange}
          />
        )}
      </div>
    </div>
  )
}

function ModeToggle({
  mode,
  loading,
  filesCount,
  onSwitchToLive,
  onSwitchToStatic,
}: {
  mode: LogsMode
  loading: boolean
  filesCount: number
  onSwitchToLive: () => void
  onSwitchToStatic: () => void
}) {
  return (
    <div className="bg-panel-subtle border-line-soft flex rounded-[4px] border p-0.5 shadow-inner">
      <Button
        variant="outline"
        size="sm"
        onClick={onSwitchToLive}
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
        onClick={onSwitchToStatic}
        disabled={filesCount === 0}
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

function FileSelector({
  files,
  selectedFile,
  onFileChange,
}: {
  files: LogFileItem[]
  selectedFile: string | null
  onFileChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <History className="text-muted-copy h-3 w-3" />
      <Select
        value={selectedFile ?? undefined}
        onValueChange={onFileChange}
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
  )
}
