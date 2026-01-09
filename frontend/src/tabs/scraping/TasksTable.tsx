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
import { Eye, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'

type EligibleProfile = { id: string; name: string }

function parseTargets(raw: string): string[] {
  const text = String(raw || '')
  if (!text.trim()) return []
  const parts = text
    .split(/\r?\n/)
    .flatMap((line) => line.split(','))
    .map((v) => String(v || '').trim().replace(/^@+/, ''))
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
  selectedId: Id<'scrapingTasks'> | null
  onSelect: (id: Id<'scrapingTasks'>) => void
  eligibleProfiles: EligibleProfile[]
  running: boolean
  onRun: (task: Doc<'scrapingTasks'>) => void
  onEdit: (task: Doc<'scrapingTasks'>) => void
  onViewOutput: (task: Doc<'scrapingTasks'>) => void
  onDelete: (task: Doc<'scrapingTasks'>) => void
}

export function TasksTable({
  tasks,
  selectedId,
  onSelect,
  eligibleProfiles,
  running,
  onRun,
  onEdit,
  onViewOutput,
  onDelete,
}: Props) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Limit</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const taskMode = task.mode === 'manual' ? 'manual' : 'auto'
            const profileName =
              taskMode === 'manual'
                ? eligibleProfiles.find((p) => p.id === task.profileId)?.name || task.profileId || '—'
                : 'Auto distribution'
            const eligibleCount = eligibleProfiles.length
            const perProfileHint =
              taskMode === 'auto'
                ? typeof task.limitPerProfile === 'number'
                  ? task.limitPerProfile
                  : eligibleCount > 0
                    ? Math.ceil(task.limit / eligibleCount)
                    : null
                : null
            const taskStatus = task.status === 'running' || task.status === 'completed' || task.status === 'failed' ? task.status : 'idle'
            const statusBadge =
              taskStatus === 'running' ? (
                <Badge className="bg-green-600 hover:bg-green-700">Running</Badge>
              ) : taskStatus === 'failed' ? (
                <Badge variant="destructive">Failed</Badge>
              ) : taskStatus === 'completed' ? (
                <Badge>Done</Badge>
              ) : (
                <Badge variant="secondary">Idle</Badge>
              )
            const canViewOutput = task.lastOutput !== undefined || (typeof task.lastError === 'string' && task.lastError.trim())

            return (
              <TableRow
                key={String(task._id)}
                className={`cursor-pointer ${selectedId === task._id ? 'bg-muted/50' : ''}`}
                onClick={() => onSelect(task._id)}
              >
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span className="truncate max-w-[320px]">{task.name}</span>
                    <span className="text-xs text-muted-foreground">{String(task._id)}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {(() => {
                    const targets = parseTargets(String(task.targetUsername || ''))
                    const first = targets[0] || String(task.targetUsername || '')
                    const extra = targets.length > 1 ? targets.length - 1 : 0
                    return (
                      <span className="truncate max-w-[220px] block">
                        {extra > 0 ? `${first} (+${extra})` : first}
                      </span>
                    )
                  })()}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <Badge variant={taskMode === 'auto' ? 'outline' : 'secondary'}>{taskMode === 'auto' ? 'Auto' : 'Manual'}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground truncate max-w-[220px]">{profileName}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{task.limit}</span>
                    {perProfileHint ? <span className="text-xs text-muted-foreground">~{perProfileHint}/profile</span> : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{formatWhen(task.lastRunAt)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {statusBadge}
                    {typeof task.lastScraped === 'number' && <span className="text-xs text-muted-foreground">{task.lastScraped}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                      >
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onRun(task)} disabled={running}>
                        <Play className="mr-2 h-4 w-4" /> Run
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(task)} disabled={running || task.status === 'running'}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onViewOutput(task)} disabled={!canViewOutput}>
                        <Eye className="mr-2 h-4 w-4" /> View output
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onDelete(task)}
                        className="text-destructive focus:text-destructive"
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
