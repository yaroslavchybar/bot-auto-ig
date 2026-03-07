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
import { Download, Eye, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'

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
  running: boolean
  onRun: (task: Doc<'scrapingTasks'>) => void
  onResume: (task: Doc<'scrapingTasks'>) => void
  onEdit: (task: Doc<'scrapingTasks'>) => void
  onViewOutput: (task: Doc<'scrapingTasks'>) => void
  onDelete: (task: Doc<'scrapingTasks'>) => void
}

export function TasksTable({
  tasks,
  selectedId,
  onSelect,
  running,
  onRun,
  onResume,
  onEdit,
  onViewOutput,
  onDelete,
}: Props) {
  const handleDownload = async (task: Doc<'scrapingTasks'>) => {
    if (!task.storageId) return

    try {
      // Get the download URL from Convex
      const url = await fetch(`https://${import.meta.env.VITE_CONVEX_URL?.replace('.convex.cloud', '.convex.site')}/api/scraping-tasks/storage-url?storageId=${task.storageId}`, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_CONVEX_API_KEY || ''}`,
        },
      }).then(r => r.json())

      if (url) {
        // Download the file
        const link = document.createElement('a')
        link.href = url
        link.download = `${task.name}_${task.kind}_${new Date(task.lastRunAt || task.createdAt).toISOString().split('T')[0]}.json`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    } catch (error) {
      console.error('Failed to download file:', error)
    }
  }
  return (
    <div className="w-full">
      <Table>
        <TableHeader className="border-b border-white/[0.05]">
          <TableRow className="hover:bg-transparent border-0 border-b border-white/[0.05]">
            <TableHead className="text-gray-400 font-medium">Name</TableHead>
            <TableHead className="text-gray-400 font-medium">Type</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-gray-400 font-medium text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const taskStatus =
              task.status === 'running' || task.status === 'paused' || task.status === 'completed' || task.status === 'failed' ? task.status : 'idle'
            const statusBadge =
              taskStatus === 'running' ? (
                <Badge className="bg-green-500/10 text-green-400 border border-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)] hover:bg-green-500/20 transition-colors">Running</Badge>
              ) : taskStatus === 'paused' ? (
                <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors">Paused</Badge>
              ) : taskStatus === 'failed' ? (
                <Badge className="bg-red-500/10 text-red-400 border border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.2)] hover:bg-red-500/20 transition-colors">Failed</Badge>
              ) : taskStatus === 'completed' ? (
                <Badge className="bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 transition-colors">Done</Badge>
              ) : (
                <Badge className="bg-transparent text-gray-500 border border-white/5">Idle</Badge>
              )
            const canViewOutput = task.lastOutput !== undefined || (typeof task.lastError === 'string' && task.lastError.trim())
            const canResume = (() => {
              if (taskStatus === 'paused') return true
              if (!task.lastOutput || typeof task.lastOutput !== 'object') return false
              const r = task.lastOutput as Record<string, unknown>
              const state = r.resumeState
              if (!state || typeof state !== 'object') return false
              const done = (state as Record<string, unknown>).done
              return done === false
            })()

            return (
              <TableRow
                key={String(task._id)}
                className={`cursor-pointer border-b border-white/[0.05] transition-colors ${selectedId === task._id ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                  }`}
                onClick={() => onSelect(task._id)}
              >
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span className="truncate max-w-[320px] text-gray-200">{task.name}</span>
                    <span className="text-xs text-gray-500">{String(task._id)}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className="bg-white/5 text-gray-400 border border-white/10 font-normal hover:bg-white/10">
                    {task.kind === 'following' ? 'Following' : 'Followers'}
                  </Badge>
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
                <TableCell className="text-gray-500 text-sm">{formatWhen(task.lastRunAt)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {statusBadge}
                    {typeof task.lastScraped === 'number' && <span className="text-xs text-gray-500">{task.lastScraped}</span>}
                    {task.storageId && (
                      <Badge className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs hover:bg-blue-500/20 transition-colors">
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
                        className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-white/10"
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                      >
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-[#0f0f0f] border-white/10 text-gray-200" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onRun(task)} disabled={running}>
                        <Play className="mr-2 h-4 w-4" /> Run
                      </DropdownMenuItem>
                      {canResume && (
                        <DropdownMenuItem onClick={() => onResume(task)} disabled={running}>
                          <Play className="mr-2 h-4 w-4" /> Resume
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => onEdit(task)} disabled={running || task.status === 'running'}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onViewOutput(task)} disabled={!canViewOutput}>
                        <Eye className="mr-2 h-4 w-4" /> View output
                      </DropdownMenuItem>
                      {task.storageId && (
                        <DropdownMenuItem onClick={() => void handleDownload(task)} className="hover:bg-white/5 focus:bg-white/5 cursor-pointer">
                          <Download className="mr-2 h-4 w-4" /> Download JSON
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator className="bg-white/10" />
                      <DropdownMenuItem
                        onClick={() => onDelete(task)}
                        className="text-red-400 focus:text-red-300 focus:bg-red-500/10 hover:bg-red-500/10 cursor-pointer"
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
