import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
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
  const [actionTaskId, setActionTaskId] = useState<Id<'scrapingTasks'> | null>(
    null,
  )

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
  const updateTaskMutation = useMutation(api.scrapingTasks.update)
  const removeTaskMutation = useMutation(api.scrapingTasks.remove)

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

    const baseName = String(taskName || '').trim()

    try {
      const name = baseName ? baseName : `${firstTarget} ${kind}`
      const created = await apiFetch<unknown>('/api/scraping/jobs', {
        method: 'POST',
        body: {
          name,
          kind,
          targets,
        },
      })
      setIsCreateOpen(false)
      void created
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [canCreate, kind, targetUsername, taskName])

  const withTaskAction = useCallback(
    async (
      taskId: Id<'scrapingTasks'>,
      action: () => Promise<unknown>,
      options?: { closeDeleteDialog?: boolean },
    ) => {
      if (actionTaskId) return
      setActionTaskId(taskId)
      setError(null)
      try {
        await action()
        if (options?.closeDeleteDialog) {
          setDeleteTaskId(null)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setActionTaskId(null)
      }
    },
    [actionTaskId],
  )

  const handleStartTask = useCallback(
    async (task: Doc<'scrapingTasks'>) => {
      await withTaskAction(task._id, async () => {
        await apiFetch(`/api/scraping/jobs/${task._id}/start`, {
          method: 'POST',
        })
      })
    },
    [withTaskAction],
  )

  const handlePauseTask = useCallback(
    async (task: Doc<'scrapingTasks'>) => {
      await withTaskAction(task._id, async () => {
        await apiFetch(`/api/scraping/jobs/${task._id}/pause`, {
          method: 'POST',
        })
      })
    },
    [withTaskAction],
  )

  const handleResumeTask = useCallback(
    async (task: Doc<'scrapingTasks'>) => {
      await withTaskAction(task._id, async () => {
        await apiFetch(`/api/scraping/jobs/${task._id}/resume`, {
          method: 'POST',
        })
      })
    },
    [withTaskAction],
  )

  const handleCancelTask = useCallback(
    async (task: Doc<'scrapingTasks'>) => {
      await withTaskAction(task._id, async () => {
        await apiFetch(`/api/scraping/jobs/${task._id}/cancel`, {
          method: 'POST',
        })
      })
    },
    [withTaskAction],
  )

  const handleViewOutput = useCallback((task: Doc<'scrapingTasks'>) => {
    setOutputTaskId(task._id)
    const output =
      task.lastOutput ??
      {
        status: task.status,
        stats: task.stats,
        lastError: task.lastError,
        lastErrorCode: task.lastErrorCode,
        lastErrorMessage: task.lastErrorMessage,
        manifestStorageId: task.manifestStorageId,
        storageId: task.storageId,
        assignedProfileName: task.assignedProfileName,
        heartbeatAt: task.heartbeatAt,
      }
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
    const task = tasksList.find((item) => item._id === id) ?? null
    const status = String(task?.status || 'idle').toLowerCase()

    await withTaskAction(
      id,
      async () => {
        if (
          status === 'queued' ||
          status === 'leasing' ||
          status === 'running' ||
          status === 'paused' ||
          status === 'retry_wait'
        ) {
          await apiFetch(`/api/scraping/jobs/${id}/cancel`, {
            method: 'POST',
          })
        } else {
          await removeTaskMutation({ id })
        }

        if (editTaskId === id) {
          setEditTaskId(null)
        }
        if (outputTaskId === id) {
          setOutputTaskId(null)
          setIsOutputOpen(false)
          setOutputPayload(null)
          setOutputTitle('')
        }
      },
      { closeDeleteDialog: true },
    )
  }, [deleteTaskId, editTaskId, outputTaskId, removeTaskMutation, tasksList, withTaskAction])

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
              size="icon"
              onClick={() => void refreshAll()}
              disabled={eligibleLoading || Boolean(actionTaskId)}
              aria-label="Refresh profiles"
              title="Refresh profiles"
              className="h-8 w-8 shrink-0 p-0"
            >
              <RefreshCw
                className={eligibleLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
              />
              <span className="sr-only">Refresh</span>
            </Button>

            <Button
              size="icon"
              onClick={handleOpenCreate}
              disabled={eligibleLoading || Boolean(actionTaskId)}
              className="mobile-effect-shadow brand-button h-8 w-auto px-3.5 text-sm"
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
              running={Boolean(actionTaskId)}
              onRun={(task) => void handleStartTask(task)}
              onResume={(task) => void handleResumeTask(task)}
              onPause={(task) => void handlePauseTask(task)}
              onCancel={(task) => void handleCancelTask(task)}
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
        disabled={Boolean(actionTaskId)}
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
        disabled={Boolean(actionTaskId)}
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
        disabled={Boolean(actionTaskId) || !deleteTaskId}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  )
}




