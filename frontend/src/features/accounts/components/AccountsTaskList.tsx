import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { FileSpreadsheet, Loader2, Search } from 'lucide-react'
import type { ScrapingTaskRow } from '../types'
import type { AccountsState } from '../hooks/useAccountsState'
import { formatDate } from '../hooks/useAccountsState'
import { StatusBanner } from './AccountsShared'

interface AccountsTaskListProps {
  accounts: AccountsState
  isMobile: boolean
  detailsPanel: React.ReactNode
}

function TaskSearchBar({ accounts }: { accounts: AccountsState }) {
  const { taskSearchQuery, setTaskSearchQuery, tasksKind, setTasksKind } =
    accounts

  return (
    <div className="bg-panel-subtle border-line-soft rounded-3xl border p-4 shadow-xs backdrop-blur-xs">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative w-full xl:max-w-xl xl:flex-1">
          <Search className="text-subtle-copy pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={taskSearchQuery}
            onChange={(event) => setTaskSearchQuery(event.target.value)}
            placeholder="Search workflow scrape artifacts..."
            className="brand-focus brand-focus-strong border-line bg-panel-strong text-ink placeholder:text-subtle-copy h-11 rounded-xl pl-10"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={tasksKind === '' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTasksKind('')}
          >
            All
          </Button>
          <Button
            variant={tasksKind === 'followers' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTasksKind('followers')}
          >
            Followers
          </Button>
          <Button
            variant={tasksKind === 'following' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTasksKind('following')}
          >
            Following
          </Button>
        </div>
      </div>
    </div>
  )
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
          : 'Completed unimported storage-backed workflow scrape artifacts will appear here. Direct-processed runs are handled automatically.'}
      </p>
    </div>
  )
}

function MobileTaskCard({
  task,
  isSelected,
  onSelect,
}: {
  task: ScrapingTaskRow
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  const taskId = String(task._id || '')

  return (
    <button
      key={taskId}
      type="button"
      onClick={() => onSelect(taskId)}
      className={cn(
        'button-panel w-full rounded-2xl p-4 text-left',
        isSelected && 'border-brand',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-ink truncate font-semibold">
            {task.name || 'Untitled artifact'}
          </div>
          <div className="text-subtle-copy mt-1 text-xs">
            {formatDate(task.createdAt)}
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

function DesktopTaskTable({
  tasks,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: ScrapingTaskRow[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
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
          return (
            <TableRow
              key={taskId}
              onClick={() => onSelectTask(taskId)}
              className={cn(
                'group border-line-soft cursor-pointer border-b transition-colors hover:bg-panel-subtle',
                isSelected && 'bg-panel-subtle',
              )}
            >
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
    taskSearchQuery,
    handleSelectTask,
  } = accounts

  return (
    <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-3xl border shadow-xs backdrop-blur-xs">
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
                onSelect={(id) => void handleSelectTask(id)}
              />
            )
          })}
        </div>
      ) : (
        <DesktopTaskTable
          tasks={filteredScrapingTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={(id) => void handleSelectTask(id)}
        />
      )}
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

      <TaskSearchBar accounts={accounts} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.95fr)]">
        <TaskListPanel accounts={accounts} isMobile={isMobile} />
        {detailsPanel}
      </div>
    </div>
  )
}
