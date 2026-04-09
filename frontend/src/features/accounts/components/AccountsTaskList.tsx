import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import type { ScrapingTaskRow } from '../types'
import type { AccountsState } from '../hooks/useAccountsState'
import { formatDate } from '../hooks/useAccountsState'
import {
  ProcessingResultPanel,
  StatusBanner,
} from './AccountsShared'

interface AccountsTaskListProps {
  accounts: AccountsState
  isMobile: boolean
  detailsPanel: React.ReactNode
}

function TaskEmptyState({ hasSearchQuery }: { hasSearchQuery: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <FileSpreadsheet className="text-subtle-copy mb-4 h-10 w-10" />
      <h3 className="text-lg font-medium">
        {hasSearchQuery
          ? 'No matching artifacts'
          : 'No workflow scrape artifacts ready'}
      </h3>
      <p className="text-subtle-copy mt-1 text-sm">
        {hasSearchQuery
          ? 'Try a different query or clear the filter.'
          : 'Completed workflow scrape artifacts queued for manual filtering and import will appear here.'}
      </p>
    </div>
  )
}

function MobileTaskCard({
  task,
  isSelected,
  isChecked,
  disabled,
  onSelect,
  onToggle,
}: {
  task: ScrapingTaskRow
  isSelected: boolean
  isChecked: boolean
  disabled: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}) {
  const taskId = String(task._id || '')

  return (
    <button
      key={taskId}
      type="button"
      onClick={() => onSelect(taskId)}
      className={cn(
        'button-panel w-full rounded-2xl p-4 text-left',
        (isSelected || isChecked) && 'border-brand',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="pt-0.5"
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              checked={isChecked}
              disabled={disabled}
              aria-label={`Select ${task.name || 'artifact'}`}
              onCheckedChange={() => onToggle(taskId)}
            />
          </div>
          <div className="min-w-0">
            <div className="text-ink truncate font-semibold">
              {task.name || 'Untitled artifact'}
            </div>
            <div className="text-subtle-copy mt-1 text-xs">
              {formatDate(task.createdAt)}
            </div>
          </div>
        </div>
        <Badge
          variant="outline"
          className="border-line bg-panel-muted text-copy"
        >
          {task.kind || '-'}
        </Badge>
      </div>
    </button>
  )
}

function TaskBulkActionBar({ accounts }: { accounts: AccountsState }) {
  const {
    filteredScrapingTasks,
    selectedTaskIds,
    allVisibleSelected,
    someVisibleSelected,
    bulkProcessing,
    bulkProcessingLabel,
    bulkProgress,
    handleToggleAllVisibleSelection,
    clearSelectedTasks,
    handleProcessSelectedTasks,
  } = accounts

  if (filteredScrapingTasks.length === 0) {
    return null
  }

  return (
    <div className="border-line-soft flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Checkbox
          checked={
            allVisibleSelected
              ? true
              : someVisibleSelected
                ? 'indeterminate'
                : false
          }
          disabled={bulkProcessing}
          aria-label="Select all visible artifacts"
          onCheckedChange={(checked) =>
            handleToggleAllVisibleSelection(checked === true)
          }
        />
        <div className="text-ink truncate font-semibold">
          {selectedTaskIds.length > 0
            ? `${selectedTaskIds.length} selected`
            : 'Select artifacts to import in bulk'}
        </div>
        {bulkProcessing ? (
          <div className="text-subtle-copy text-xs">
            {bulkProgress.current}/{bulkProgress.total}
            {bulkProcessingLabel ? ` • ${bulkProcessingLabel}` : ''}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {selectedTaskIds.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={clearSelectedTasks}
            disabled={bulkProcessing}
          >
            Clear selection
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={() => void handleProcessSelectedTasks()}
          disabled={selectedTaskIds.length === 0 || bulkProcessing}
        >
          {bulkProcessing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Importing...
            </>
          ) : (
            'Filter & Import selected'
          )}
        </Button>
      </div>
    </div>
  )
}

function DesktopTaskTable({
  tasks,
  selectedTaskId,
  selectedTaskIds,
  allVisibleSelected,
  someVisibleSelected,
  bulkProcessing,
  onSelectTask,
  onToggleTaskSelection,
  onToggleAllVisibleSelection,
}: {
  tasks: ScrapingTaskRow[]
  selectedTaskId: string | null
  selectedTaskIds: string[]
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  bulkProcessing: boolean
  onSelectTask: (id: string) => void
  onToggleTaskSelection: (id: string) => void
  onToggleAllVisibleSelection: (checked: boolean) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
          <TableHead className="h-12 w-12 pl-4">
            <Checkbox
              checked={
                allVisibleSelected
                  ? true
                  : someVisibleSelected
                    ? 'indeterminate'
                    : false
              }
              disabled={bulkProcessing}
              aria-label="Select all visible artifacts"
              onCheckedChange={(checked) =>
                onToggleAllVisibleSelection(checked === true)
              }
            />
          </TableHead>
          <TableHead className="text-muted-copy h-12 pl-4 font-medium">
            Artifact
          </TableHead>
          <TableHead className="text-muted-copy h-12 font-medium">
            Kind
          </TableHead>
          <TableHead className="text-muted-copy h-12 font-medium">
            Status
          </TableHead>
          <TableHead className="text-muted-copy h-12 pr-4 font-medium">
            Created
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => {
          const taskId = String(task._id || '')
          const isSelected = taskId === selectedTaskId
          const isChecked = selectedTaskIds.includes(taskId)
          return (
            <TableRow
              key={taskId}
              onClick={() => onSelectTask(taskId)}
              className={cn(
                'group border-line-soft cursor-pointer border-b transition-colors hover:bg-panel-subtle',
                (isSelected || isChecked) && 'bg-panel-subtle',
              )}
            >
              <TableCell
                className="w-12 pl-4"
                onClick={(event) => event.stopPropagation()}
              >
                <Checkbox
                  checked={isChecked}
                  disabled={bulkProcessing}
                  aria-label={`Select ${task.name || 'artifact'}`}
                  onCheckedChange={() => onToggleTaskSelection(taskId)}
                />
              </TableCell>
              <TableCell className="pl-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-ink truncate font-medium">
                    {task.name || 'Untitled artifact'}
                  </span>
                  <span className="text-subtle-copy max-w-[320px] truncate text-[11px]">
                    {task.targetUsername || '-'}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className="border-line bg-panel-muted text-copy"
                >
                  {task.kind || '-'}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="text-copy text-sm">
                  {task.status || 'completed'}
                </span>
              </TableCell>
              <TableCell className="pr-4 text-sm text-muted-foreground">
                {formatDate(task.createdAt)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function TaskListPanel({
  accounts,
  isMobile,
}: {
  accounts: AccountsState
  isMobile: boolean
}) {
  const {
    filteredScrapingTasks,
    scrapingLoading,
    selectedTaskId,
    selectedTaskIds,
    allVisibleSelected,
    someVisibleSelected,
    bulkProcessing,
    taskSearchQuery,
    handleSelectTask,
    handleToggleTaskSelection,
    handleToggleAllVisibleSelection,
  } = accounts

  return (
    <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-3xl border shadow-xs backdrop-blur-xs">
      <TaskBulkActionBar accounts={accounts} />

      {scrapingLoading ? (
        <div className="flex items-center justify-center px-6 py-12 text-sm">
          <Loader2 className="text-brand mr-2 h-4 w-4 animate-spin" />
          Loading workflow artifacts...
        </div>
      ) : filteredScrapingTasks.length === 0 ? (
        <TaskEmptyState hasSearchQuery={taskSearchQuery.trim().length > 0} />
      ) : isMobile ? (
        <div className="space-y-3 p-3">
          {filteredScrapingTasks.map((task) => {
            const taskId = String(task._id || '')
            return (
              <MobileTaskCard
                key={taskId}
                task={task}
                isSelected={taskId === selectedTaskId}
                isChecked={selectedTaskIds.includes(taskId)}
                disabled={bulkProcessing}
                onSelect={(id) => void handleSelectTask(id)}
                onToggle={handleToggleTaskSelection}
              />
            )
          })}
        </div>
      ) : (
        <DesktopTaskTable
          tasks={filteredScrapingTasks}
          selectedTaskId={selectedTaskId}
          selectedTaskIds={selectedTaskIds}
          allVisibleSelected={allVisibleSelected}
          someVisibleSelected={someVisibleSelected}
          bulkProcessing={bulkProcessing}
          onSelectTask={(id) => void handleSelectTask(id)}
          onToggleTaskSelection={handleToggleTaskSelection}
          onToggleAllVisibleSelection={handleToggleAllVisibleSelection}
        />
      )}
    </div>
  )
}

function BulkImportResultPanel({ accounts }: { accounts: AccountsState }) {
  const { bulkResult, bulkError, clearBulkResult } = accounts

  if (!bulkResult && !bulkError) {
    return null
  }

  return (
    <div className="space-y-3">
      {bulkResult ? (
        <ProcessingResultPanel
          title="Bulk artifact import complete"
          summary={{
            stats: bulkResult.stats,
            uploaded: bulkResult.uploaded,
            duplicates: bulkResult.duplicates,
            scrapingInserted: bulkResult.scrapingInserted,
            scrapingDuplicates: bulkResult.scrapingDuplicates,
          }}
          actionLabel="Clear bulk result"
          onReset={clearBulkResult}
        />
      ) : null}

      {bulkError ? (
        <StatusBanner tone="danger">{bulkError}</StatusBanner>
      ) : null}

      {bulkResult?.skippedArtifacts.length ? (
        <StatusBanner tone="warning">
          Skipped {bulkResult.skippedArtifacts.length} artifact(s) without a
          supported username field.
        </StatusBanner>
      ) : null}

      {bulkResult?.failedArtifacts.length ? (
        <StatusBanner tone="danger">
          Failed to import {bulkResult.failedArtifacts.length} artifact(s). The
          failed items remain in the list.
        </StatusBanner>
      ) : null}
    </div>
  )
}

export function AccountsTaskList({
  accounts,
  isMobile,
  detailsPanel,
}: AccountsTaskListProps) {
  const { scrapingError } = accounts

  return (
    <div className="space-y-4">
      {scrapingError ? (
        <StatusBanner tone="danger">{scrapingError}</StatusBanner>
      ) : null}

      <BulkImportResultPanel accounts={accounts} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.95fr)]">
        <TaskListPanel accounts={accounts} isMobile={isMobile} />
        {detailsPanel}
      </div>
    </div>
  )
}
