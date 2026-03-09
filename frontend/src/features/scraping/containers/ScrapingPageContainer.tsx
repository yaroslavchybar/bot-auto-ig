import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { apiFetch, apiFetchWithRetry } from '@/lib/api'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../../convex/_generated/dataModel'
import { Plus, RefreshCw } from 'lucide-react'
import { TasksTable } from '../components/TasksTable'
import { TaskDialog } from '../components/TaskDialog'
import { OutputDialog } from '../components/OutputDialog'
import { DeleteTaskDialog } from '../components/DeleteTaskDialog'
import { AmbientGlow } from '@/components/ui/ambient-glow'

type EligibleProfile = { id: string; name: string }

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

export function ScrapingPageContainer() {
  const [kind, setKind] = useState<'followers' | 'following'>('followers')
  const [targetUsername, setTargetUsername] = useState('')
  const [taskName, setTaskName] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isOutputOpen, setIsOutputOpen] = useState(false)
  const [outputTitle, setOutputTitle] = useState('')
  const [outputPayload, setOutputPayload] = useState<unknown>(null)
  const [editTaskId, setEditTaskId] = useState<Id<'scrapingTasks'> | null>(
    null,
  )
  const [outputTaskId, setOutputTaskId] = useState<Id<'scrapingTasks'> | null>(
    null,
  )
  const [deleteTaskId, setDeleteTaskId] = useState<Id<'scrapingTasks'> | null>(
    null,
  )
  const [runningId, setRunningId] = useState<Id<'scrapingTasks'> | null>(null)

  const [eligibleProfiles, setEligibleProfiles] = useState<EligibleProfile[]>(
    [],
  )
  const [eligibleLoading, setEligibleLoading] = useState(false)
  const [eligibleError, setEligibleError] = useState<string | null>(null)

  const refreshEligibleProfiles = useCallback(async () => {
    setEligibleLoading(true)
    setEligibleError(null)
    try {
      const data = await apiFetch<{ profiles: EligibleProfile[] }>(
        '/api/scraping/eligible-profiles',
      )
      setEligibleProfiles(Array.isArray(data.profiles) ? data.profiles : [])
    } catch (e) {
      setEligibleError(e instanceof Error ? e.message : String(e))
      setEligibleProfiles([])
    } finally {
      setEligibleLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshEligibleProfiles()
  }, [refreshEligibleProfiles])

  const tasks = useQuery(api.scrapingTasks.list, {}) as
    | Doc<'scrapingTasks'>[]
    | undefined
  const createTaskMutation = useMutation(api.scrapingTasks.create)
  const updateTaskMutation = useMutation(api.scrapingTasks.update)
  const removeTaskMutation = useMutation(api.scrapingTasks.remove)
  const setTaskStatusMutation = useMutation(api.scrapingTasks.setStatus)

  const tasksList = useMemo(() => tasks ?? [], [tasks])
  const tasksLoading = tasks === undefined

  const canCreate = useMemo(() => {
    if (parseTargets(targetUsername).length === 0) return false
    return true
  }, [targetUsername])

  const [editKind, setEditKind] = useState<'followers' | 'following'>(
    'followers',
  )
  const [editTargetUsername, setEditTargetUsername] = useState('')
  const [editTaskName, setEditTaskName] = useState('')

  const handleOpenCreate = useCallback(() => {
    setIsCreateOpen(true)
    setError(null)
    setOutputPayload(null)
    setOutputTitle('')
    setTaskName('')
  }, [])

  const handleCloseCreate = useCallback(() => {
    setIsCreateOpen(false)
    setError(null)
  }, [])

  const handleOpenEdit = useCallback((task: Doc<'scrapingTasks'>) => {
    setEditTaskId(task._id)
    setError(null)

    const taskKind = task.kind === 'following' ? 'following' : 'followers'
    setEditKind(taskKind)
    setEditTargetUsername(String(task.targetUsername || ''))
    setEditTaskName(String(task.name || ''))
  }, [])

  const handleCloseEdit = useCallback(() => {
    setEditTaskId(null)
    setError(null)
  }, [])

  const canSaveEdit = useMemo(() => {
    if (!editTaskId) return false
    if (!editTaskName.trim()) return false
    if (parseTargets(editTargetUsername).length === 0) return false
    return true
  }, [editTargetUsername, editTaskId, editTaskName])

  const handleCreateTask = useCallback(async () => {
    if (!canCreate) return
    const targets = parseTargets(targetUsername)
    const firstTarget = targets[0] || ''
    if (!firstTarget) return
    const packedTargets = targets.join('\n')

    const baseName = String(taskName || '').trim()

    try {
      const name = baseName ? baseName : `${firstTarget} ${kind}`
      const created = await createTaskMutation({
        name,
        kind,
        targetUsername: packedTargets,
      })
      setIsCreateOpen(false)
      void created
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [canCreate, createTaskMutation, kind, taskName, targetUsername])

  const handleRunTask = useCallback(
    async (task: Doc<'scrapingTasks'>, opts?: { resume?: boolean }) => {
      if (runningId) return

      const taskTargets = parseTargets(String(task.targetUsername || ''))
      if (taskTargets.length === 0) return

      setRunningId(task._id)
      setError(null)

      const startAt = Date.now()
      await setTaskStatusMutation({
        id: task._id,
        status: 'running',
        lastRunAt: startAt,
        lastError: undefined,
        lastScraped: undefined,
      })

      const taskKind = task.kind === 'following' ? 'following' : 'followers'
      const apiEndpoint =
        taskKind === 'following'
          ? '/api/scraping/following-chunk'
          : '/api/scraping/followers-chunk'
      const resume = Boolean(opts?.resume)
      const existingResumeState = (() => {
        if (!task.lastOutput || typeof task.lastOutput !== 'object')
          return undefined
        const r = task.lastOutput as Record<string, unknown>
        return r.resumeState
      })()

      try {
        const startedAt = Date.now()
        let lastOutput: unknown = null
        let lastStorageId: unknown = task.storageId
        let resumeState: unknown = resume ? existingResumeState : undefined
        let done = false
        let capacityExhaustedMessage: string | undefined
        let chunkLimit = 100
        let maxPages = 3

        const getDone = (res: unknown): boolean => {
          if (!res || typeof res !== 'object') return false
          const r = res as Record<string, unknown>
          return r.done === true
        }

        const getResumeState = (res: unknown): unknown => {
          if (!res || typeof res !== 'object') return undefined
          const r = res as Record<string, unknown>
          return r.resumeState
        }

        const getStorageId = (res: unknown): unknown => {
          if (!res || typeof res !== 'object') return undefined
          const r = res as Record<string, unknown>
          return r.storageId
        }

        const getCapacityExhaustedMessage = (
          res: unknown,
        ): string | undefined => {
          if (!res || typeof res !== 'object') return undefined
          const r = res as Record<string, unknown>
          if (r.capacityExhausted !== true) return undefined
          return typeof r.error === 'string' && r.error.trim()
            ? r.error
            : 'Daily scraping capacity exhausted before all targets were completed'
        }

        const maxIterations = 50
        for (let i = 0; i < maxIterations; i++) {
          if (Date.now() - startedAt > 110000) break

          let output: unknown
          try {
            output = await apiFetchWithRetry<unknown>(apiEndpoint, {
              method: 'POST',
              body: {
                targetUsernames: taskTargets,
                taskId: task._id,
                resume: resume || i > 0,
                ...(resume || i > 0
                  ? { resumeState, storageId: lastStorageId }
                  : {}),
                chunkLimit,
                maxPages,
              },
              timeout: 45000,
              maxRetries: 2,
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            const lower = msg.toLowerCase()
            const looksLike504 =
              lower.includes('504') ||
              lower.includes('gateway time-out') ||
              lower.includes('gateway timeout')
            if (looksLike504 && (chunkLimit > 25 || maxPages > 1)) {
              chunkLimit = Math.max(25, Math.min(chunkLimit, 50))
              maxPages = 1
              output = await apiFetchWithRetry<unknown>(apiEndpoint, {
                method: 'POST',
                body: {
                  targetUsernames: taskTargets,
                  taskId: task._id,
                  resume: resume || i > 0,
                  ...(resume || i > 0
                    ? { resumeState, storageId: lastStorageId }
                    : {}),
                  chunkLimit,
                  maxPages,
                },
                timeout: 45000,
                maxRetries: 1,
              })
            } else {
              throw e
            }
          }

          lastOutput = output
          resumeState = getResumeState(output)
          const sid = getStorageId(output)
          if (sid !== undefined) lastStorageId = sid

          done = getDone(output)
          capacityExhaustedMessage = getCapacityExhaustedMessage(output)

          await setTaskStatusMutation({
            id: task._id,
            status: done ? 'completed' : 'running',
            lastRunAt: startAt,
            lastScraped: undefined,
            lastError: capacityExhaustedMessage,
            lastOutput,
          })

          if (done || capacityExhaustedMessage) break
          await new Promise((r) => setTimeout(r, 250))
        }

        const getLastScraped = (res: unknown): number | undefined => {
          if (!res || typeof res !== 'object') return undefined
          const r = res as Record<string, unknown>
          const v =
            typeof r.totalStored === 'number'
              ? r.totalStored
              : typeof r.totalScraped === 'number'
                ? r.totalScraped
                : typeof r.scraped === 'number'
                  ? r.scraped
                  : undefined
          return typeof v === 'number' && Number.isFinite(Number(v))
            ? Number(v)
            : undefined
        }

        const lastScraped = getLastScraped(lastOutput)
        await setTaskStatusMutation({
          id: task._id,
          status: done ? 'completed' : 'paused',
          lastRunAt: startAt,
          lastScraped,
          lastError: capacityExhaustedMessage,
          lastOutput: lastOutput ?? undefined,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await setTaskStatusMutation({
          id: task._id,
          status: 'failed',
          lastRunAt: startAt,
          lastError: message,
          lastScraped: undefined,
          lastOutput: { error: message },
        })
      } finally {
        setRunningId(null)
      }
    },
    [runningId, setTaskStatusMutation],
  )

  const handleViewOutput = useCallback((task: Doc<'scrapingTasks'>) => {
    setOutputTaskId(task._id)
    const output = task.lastOutput ?? task.lastError
    setOutputTitle(task.name)
    setOutputPayload(output)
    setIsOutputOpen(true)
  }, [])

  const refreshAll = useCallback(async () => {
    await refreshEligibleProfiles()
  }, [refreshEligibleProfiles])

  const editTask = useMemo(
    () => tasksList.find((task) => task._id === editTaskId) ?? null,
    [editTaskId, tasksList],
  )
  const deleteTask = useMemo(
    () => tasksList.find((task) => task._id === deleteTaskId) ?? null,
    [deleteTaskId, tasksList],
  )

  useEffect(() => {
    if (editTaskId && !editTask) {
      setEditTaskId(null)
    }
    if (deleteTaskId && !deleteTask) {
      setDeleteTaskId(null)
    }
    if (outputTaskId && !tasksList.find((task) => task._id === outputTaskId)) {
      setOutputTaskId(null)
      setIsOutputOpen(false)
      setOutputPayload(null)
      setOutputTitle('')
    }
  }, [deleteTask, deleteTaskId, editTask, editTaskId, outputTaskId, tasksList])

  const handleConfirmDelete = useCallback(async () => {
    const id = deleteTaskId
    if (!id) return
    try {
      await removeTaskMutation({ id })
      setDeleteTaskId(null)
      if (editTaskId === id) {
        setEditTaskId(null)
      }
      if (outputTaskId === id) {
        setOutputTaskId(null)
        setIsOutputOpen(false)
        setOutputPayload(null)
        setOutputTitle('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [deleteTaskId, editTaskId, outputTaskId, removeTaskMutation])

  const handleSaveEdit = useCallback(async () => {
    if (!editTaskId) return
    if (!canSaveEdit) return

    const cleanedName = editTaskName.trim()
    const cleanedTargets = parseTargets(editTargetUsername)
    const packedTargets = cleanedTargets.join('\n')
    if (!packedTargets) return

    try {
      await updateTaskMutation({
        id: editTaskId,
        name: cleanedName,
        kind: editKind,
        targetUsername: packedTargets,
      })
      setEditTaskId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [
    canSaveEdit,
    editTaskId,
    editKind,
    editTargetUsername,
    editTaskName,
    updateTaskMutation,
  ])

  return (
    <div className="bg-shell text-ink relative flex h-full min-h-screen flex-col overflow-hidden">
      <AmbientGlow />

      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
          <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshAll()}
            disabled={eligibleLoading || Boolean(runningId)}
            className="bg-panel-muted border-line text-copy hover:bg-panel-hover transition-all hover:text-ink"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${eligibleLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={handleOpenCreate}
            disabled={eligibleLoading || Boolean(runningId)}
            className="mobile-effect-shadow brand-button"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create task
          </Button>
        </div>
      </div>
      </div>

      {error && (
        <div className="bg-status-danger-soft border-status-danger-border text-status-danger mx-6 mt-6 rounded-xl border p-4 text-sm backdrop-blur-md">
          {error}
        </div>
      )}

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        {eligibleError && (
          <div className="border-status-danger-border bg-status-danger-soft text-status-danger mb-6 rounded-xl border p-4 text-sm backdrop-blur-md">
            {eligibleError}
          </div>
        )}

        <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border backdrop-blur-xs">
          {tasksLoading ? (
            <div className="text-subtle-copy p-12 text-center">
              Loading tasks...
            </div>
          ) : tasksList.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="bg-panel-muted border-line mb-4 flex h-16 w-16 items-center justify-center rounded-full border">
                <RefreshCw className="text-subtle-copy h-6 w-6" />
              </div>
              <p className="text-muted-copy font-medium">No tasks found</p>
              <p className="text-dim-copy mt-1 text-sm">
                Create a new task to get started.
              </p>
            </div>
          ) : (
            <TasksTable
              tasks={tasksList}
              running={Boolean(runningId)}
              onRun={(task) => void handleRunTask(task, { resume: false })}
              onResume={(task) => void handleRunTask(task, { resume: true })}
              onEdit={handleOpenEdit}
              onViewOutput={handleViewOutput}
              onDelete={(task) => {
                setDeleteTaskId(task._id)
              }}
            />
          )}
        </div>
      </div>

      <TaskDialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseCreate()
          else setIsCreateOpen(true)
        }}
        title="Create scraping task"
        idPrefix="create_scraping_task"
        taskName={taskName}
        onTaskNameChange={setTaskName}
        kind={kind}
        onKindChange={setKind}
        targetUsername={targetUsername}
        onTargetUsernameChange={setTargetUsername}
        eligibleProfiles={eligibleProfiles}
        eligibleLoading={eligibleLoading}
        submitLabel="Create"
        submitDisabled={!canCreate}
        disabled={Boolean(runningId)}
        onCancel={handleCloseCreate}
        onSubmit={() => void handleCreateTask()}
      />

      <TaskDialog
        open={Boolean(editTaskId)}
        onOpenChange={(open) => {
          if (!open) handleCloseEdit()
          else if (editTask) setEditTaskId(editTask._id)
        }}
        title="Edit scraping task"
        idPrefix="edit_scraping_task"
        taskName={editTaskName}
        onTaskNameChange={setEditTaskName}
        kind={editKind}
        onKindChange={setEditKind}
        targetUsername={editTargetUsername}
        onTargetUsernameChange={setEditTargetUsername}
        eligibleProfiles={eligibleProfiles}
        eligibleLoading={eligibleLoading}
        submitLabel="Save"
        submitDisabled={!canSaveEdit}
        disabled={Boolean(runningId)}
        onCancel={handleCloseEdit}
        onSubmit={() => void handleSaveEdit()}
      />

      <OutputDialog
        open={isOutputOpen}
        onOpenChange={(open) => {
          setIsOutputOpen(open)
          if (!open) {
            setOutputTaskId(null)
            setOutputPayload(null)
            setOutputTitle('')
          }
        }}
        title={outputTitle}
        output={outputPayload}
      />

      <DeleteTaskDialog
        open={Boolean(deleteTaskId)}
        onOpenChange={(open) => {
          if (!open) setDeleteTaskId(null)
        }}
        taskName={deleteTask?.name ?? 'this task'}
        disabled={Boolean(runningId) || !deleteTaskId}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  )
}




