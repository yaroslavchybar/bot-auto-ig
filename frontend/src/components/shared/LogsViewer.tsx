import { AlertTriangle, X } from 'lucide-react'
import { useLogsState } from './useLogsState'
import { LogsStreamControls } from './LogsStreamControls'
import { LogsFilterBar } from './LogsFilterBar'
import { LogsEntryList } from './LogsEntryList'

interface LogsViewerProps {
  className?: string
  automationId?: string | null
  profileName?: string | null
}

export function LogsViewer({
  className,
  automationId = null,
  profileName = null,
}: LogsViewerProps) {
  const state = useLogsState({ automationId, profileName })

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden bg-transparent font-sans text-xs select-none ${className || 'h-full'}`}
    >
      {/* Top Application Ribbon */}
      <div className="border-line-soft relative z-10 flex shrink-0 flex-col border-b bg-transparent shadow-xs">
        {/* Row 1: Main Controls & Connection State */}
        <LogsStreamControls
          wsConnected={state.wsConnected}
          loading={state.loading}
          onClearLive={state.handleClearLive}
        />

        {/* Row 2: Filters and View Configuration */}
        <LogsFilterBar
          filterQuery={state.filterQuery}
          onFilterQueryChange={state.setFilterQuery}
          levelFilter={state.levelFilter}
          onLevelFilterChange={state.setLevelFilter}
          showTime={state.showTime}
          onToggleTime={() => state.setShowTime((v) => !v)}
          showSource={state.showSource}
          onToggleSource={() => state.setShowSource((v) => !v)}
          showProfile={state.showProfile}
          onToggleProfile={() => state.setShowProfile((v) => !v)}
          autoScroll={state.autoScroll}
          onToggleAutoScroll={() => state.setAutoScroll((v) => !v)}
          feedDebugOnly={state.feedDebugOnly}
          onToggleFeedDebug={() => state.setFeedDebugOnly((v) => !v)}
        />
      </div>

      {/* Inline error banner for load/archive/clear failures */}
      {state.inlineError && (
        <LogsErrorBanner
          message={state.inlineError}
          onDismiss={state.dismissError}
        />
      )}

      {/* Main Data Grid */}
      <LogsEntryList
        visibleLogs={state.visibleLogs}
        filteredLogs={state.filteredLogs}
        hasMoreLogs={state.hasMoreLogs}
        loading={state.loading}
        autoScroll={state.autoScroll}
        showTime={state.showTime}
        showSource={state.showSource}
        showProfile={state.showProfile}
        onLoadMore={state.loadMoreLogs}
      />

      <LogsStatusBar
        visibleCount={state.visibleLogs.length}
        totalCount={state.filteredLogs.length}
        filterQuery={state.filterQuery}
        levelFilter={state.levelFilter}
      />
    </div>
  )
}

function LogsErrorBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="bg-status-danger-soft border-status-danger-border text-status-danger flex shrink-0 items-center gap-2 border-b px-2 py-1.5 text-[11px]">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="hover:bg-status-danger-strong shrink-0 rounded p-0.5"
        aria-label="Dismiss error"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function LogsStatusBar({
  visibleCount,
  totalCount,
  filterQuery,
  levelFilter,
}: {
  visibleCount: number
  totalCount: number
  filterQuery: string
  levelFilter: string
}) {
  return (
    <div className="border-line-soft text-subtle-copy flex h-auto min-h-[20px] shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-transparent px-2 py-1 text-[10px]">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          {visibleCount}/{totalCount} Records
        </span>
        {filterQuery && <span>Filter active</span>}
        {levelFilter !== 'all' && (
          <span>Severity: {levelFilter.toUpperCase()}</span>
        )}
      </div>
      <div className="flex items-center">
        <span className="hidden sm:inline">Mode: Live Streaming</span>
      </div>
    </div>
  )
}
