import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react'
import { useConvex } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Doc } from '../../../../../convex/_generated/dataModel'

function parseTargets(raw: string): string[] {
  const text = String(raw || '')
  if (!text.trim()) return []
  const parts = text
    .split(/\r?\n/)
    .flatMap((line) => line.split(','))
    .map((v) =>
      String(v || '')
        .trim()
        .replace(/^@+/, ''),
    )
    .filter(Boolean)
  const seen = new Set<string>()
  const unique: string[] = []
  for (const p of parts) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(p)
  }
  return unique
}

function formatWhen(ts?: number): string {
  if (!Number.isFinite(Number(ts))) return '—'
  return new Date(Number(ts)).toLocaleString()
}

type Props = {
  tasks: Doc<'scrapingTasks'>[]
  running: boolean
  onRun: (task: Doc<'scrapingTasks'>) => void
  onResume: (task: Doc<'scrapingTasks'>) => void
  onEdit: (task: Doc<'scrapingTasks'>) => void
  onViewOutput: (task: Doc<'scrapingTasks'>) => void
  onDelete: (task: Doc<'scrapingTasks'>) => void
}

export function TasksTable({
  tasks,
  running,
  onRun,
  onResume,
  onEdit,
  onViewOutput,
  onDelete,
}: Props) {
  const isMobile = useIsMobile()

  const convex = useConvex()

  const handleDownload = async (task: Doc<'scrapingTasks'>) => {
    if (!task.storageId) return

    try {
      // Get the download URL from Convex securely over WebSocket
      const url = await convex.query(api.scrapingTasks.getStorageUrl, {
        storageId: task.storageId,
      })

      if (url) {
        // Download the file
        const fileContent = await fetch(url).then((r) => r.blob())
        const objectUrl = URL.createObjectURL(fileContent)
        
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = `${task.name}_${task.kind}_${new Date(task.lastRunAt || task.createdAt).toISOString().split('T')[0]}.json`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(objectUrl)
      }
    } catch (error) {
      console.error('Failed to download file:', error)
    }
  }

  if (isMobile) {
    return (
      <div className="space-y-3 p-3">
        {tasks.map((task) => {
          const taskStatus =
            task.status === 'running' ||
            task.status === 'paused' ||
            task.status === 'completed' ||
            task.status === 'failed'
              ? task.status
              : 'idle'
          const canViewOutput =
            task.lastOutput !== undefined ||
            (typeof task.lastError === 'string' && task.lastError.trim())
          const canResume = (() => {
            if (taskStatus === 'paused') return true
            if (!task.lastOutput || typeof task.lastOutput !== 'object')
              return false
            const r = task.lastOutput as Record<string, unknown>
            const state = r.resumeState
            if (!state || typeof state !== 'object') return false
            return (state as Record<string, unknown>).done === false
          })()

          return (
            <div
              key={String(task._id)}
              className="bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-ink truncate text-base font-semibold">
                    {task.name}
                  </h3>
                  <p className="text-subtle-copy mt-1 text-[11px]">
                    {task.kind === 'following' ? 'Following' : 'Followers'}
                  </p>
                  <p className="text-copy mt-2 truncate text-sm">
                    {(() => {
                      const targets = parseTargets(
                        String(task.targetUsername || ''),
                      )
                      const first =
                        targets[0] || String(task.targetUsername || '')
                      const extra = targets.length > 1 ? targets.length - 1 : 0
                      return extra > 0 ? `${first} (+${extra})` : first
                    })()}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="text-muted-copy hover:bg-panel-hover h-8 w-8 p-0 hover:text-ink"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="panel-dropdown"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => onRun(task)}
                      disabled={running}
                    >
                      <Play className="mr-2 h-4 w-4" /> Run
                    </DropdownMenuItem>
                    {canResume ? (
                      <DropdownMenuItem
                        onClick={() => onResume(task)}
                        disabled={running}
                      >
                        <Play className="mr-2 h-4 w-4" /> Resume
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onClick={() => onEdit(task)}
                      disabled={running || task.status === 'running'}
                    >
                      <Pencil className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onViewOutput(task)}
                      disabled={!canViewOutput}
                    >
                      <Eye className="mr-2 h-4 w-4" /> View output
                    </DropdownMenuItem>
                    {task.storageId ? (
                      <DropdownMenuItem
                        onClick={() => void handleDownload(task)}
                      >
                        <Download className="mr-2 h-4 w-4" /> Download JSON
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator className="bg-panel-hover" />
                    <DropdownMenuItem
                      onClick={() => onDelete(task)}
                      className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft hover:bg-status-danger-soft cursor-pointer"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="border-line text-muted-copy mt-4 flex items-center justify-between gap-3 border-t pt-3 text-xs">
                <span>{formatWhen(task.lastRunAt)}</span>
                <div className="flex items-center gap-2">
                  {task.storageId ? (
                    <Badge
                      className="bg-status-info-soft text-status-info border-status-info-border hover:bg-status-info-strong cursor-pointer border text-xs transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDownload(task)
                      }}
                    >
                      <Download className="mr-1 h-3 w-3" /> File
                    </Badge>
                  ) : null}
                  <Badge
                    className={
                      taskStatus === 'running'
                        ? 'bg-status-success-soft text-status-success border-status-success-border border'
                        : taskStatus === 'paused'
                          ? 'bg-status-warning-soft text-status-warning border-status-warning-border border'
                          : taskStatus === 'failed'
                            ? 'bg-status-danger-soft text-status-danger border-status-danger-border border'
                            : 'text-subtle-copy border-line-soft border bg-transparent'
                    }
                  >
                    {taskStatus}
                  </Badge>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="w-full">
      <Table>
        <TableHeader className="border-line-soft border-b">
          <TableRow className="border-line-soft border-0 border-b hover:bg-transparent">
            <TableHead className="text-muted-copy font-medium">Name</TableHead>
            <TableHead className="text-muted-copy font-medium">Type</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-muted-copy text-right font-medium">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const taskStatus =
              task.status === 'running' ||
              task.status === 'paused' ||
              task.status === 'completed' ||
              task.status === 'failed'
                ? task.status
                : 'idle'
            const statusBadge =
              taskStatus === 'running' ? (
                <Badge className="status-glow-success bg-status-success-soft text-status-success border-status-success-border hover:bg-status-success-strong border transition-colors">
                  Running
                </Badge>
              ) : taskStatus === 'paused' ? (
                <Badge className="bg-status-warning-soft text-status-warning border-status-warning-border hover:bg-status-warning-strong border transition-colors">
                  Paused
                </Badge>
              ) : taskStatus === 'failed' ? (
                <Badge className="status-glow-danger bg-status-danger-soft text-status-danger border-status-danger-border hover:bg-status-danger-strong border transition-colors">
                  Failed
                </Badge>
              ) : taskStatus === 'completed' ? (
                <Badge className="bg-panel-muted text-copy border-line hover:bg-panel-hover border transition-colors">
                  Done
                </Badge>
              ) : (
                <Badge className="text-subtle-copy border-line-soft border bg-transparent">
                  Idle
                </Badge>
              )
            const canViewOutput =
              task.lastOutput !== undefined ||
              (typeof task.lastError === 'string' && task.lastError.trim())
            const canResume = (() => {
              if (taskStatus === 'paused') return true
              if (!task.lastOutput || typeof task.lastOutput !== 'object')
                return false
              const r = task.lastOutput as Record<string, unknown>
              const state = r.resumeState
              if (!state || typeof state !== 'object') return false
              const done = (state as Record<string, unknown>).done
              return done === false
            })()

            return (
              <TableRow
                key={String(task._id)}
                className="border-line-soft border-b transition-colors hover:bg-panel-subtle"
              >
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span className="text-ink max-w-[320px] truncate">
                      {task.name}
                    </span>
                    <span className="text-subtle-copy text-xs">
                      {String(task._id)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className="bg-panel-muted text-muted-copy border-line hover:bg-panel-hover border font-normal">
                    {task.kind === 'following' ? 'Following' : 'Followers'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {(() => {
                    const targets = parseTargets(
                      String(task.targetUsername || ''),
                    )
                    const first =
                      targets[0] || String(task.targetUsername || '')
                    const extra = targets.length > 1 ? targets.length - 1 : 0
                    return (
                      <span className="block max-w-[220px] truncate">
                        {extra > 0 ? `${first} (+${extra})` : first}
                      </span>
                    )
                  })()}
                </TableCell>
                <TableCell className="text-subtle-copy text-sm">
                  {formatWhen(task.lastRunAt)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {statusBadge}
                    {typeof task.lastScraped === 'number' && (
                      <span className="text-subtle-copy text-xs">
                        {task.lastScraped}
                      </span>
                    )}
                    {task.storageId && (
                      <Badge
                        className="bg-status-info-soft text-status-info border-status-info-border hover:bg-status-info-strong cursor-pointer border text-xs transition-colors"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDownload(task)
                        }}
                      >
                        <Download className="mr-1 h-3 w-3" /> File
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="text-muted-copy hover:bg-panel-hover h-8 w-8 p-0 hover:text-ink"
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                      >
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="panel-dropdown"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => onRun(task)}
                        disabled={running}
                      >
                        <Play className="mr-2 h-4 w-4" /> Run
                      </DropdownMenuItem>
                      {canResume && (
                        <DropdownMenuItem
                          onClick={() => onResume(task)}
                          disabled={running}
                        >
                          <Play className="mr-2 h-4 w-4" /> Resume
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => onEdit(task)}
                        disabled={running || task.status === 'running'}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onViewOutput(task)}
                        disabled={!canViewOutput}
                      >
                        <Eye className="mr-2 h-4 w-4" /> View output
                      </DropdownMenuItem>
                      {task.storageId && (
                        <DropdownMenuItem
                          onClick={() => void handleDownload(task)}
                          className="hover:bg-panel-muted focus:bg-panel-muted cursor-pointer"
                        >
                          <Download className="mr-2 h-4 w-4" /> Download JSON
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator className="bg-panel-hover" />
                      <DropdownMenuItem
                        onClick={() => onDelete(task)}
                        className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft hover:bg-status-danger-soft cursor-pointer"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}


