import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { apiFetch, apiFetchWithRetry } from '@/lib/api'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'
import { Plus, RefreshCw } from 'lucide-react'
import { TasksTable } from './TasksTable'
import { TaskDialog } from './TaskDialog'
import { OutputDialog } from './OutputDialog'
import { DeleteTaskDialog } from './DeleteTaskDialog'

type EligibleProfile = { id: string; name: string }

function clampLimit(limit: string | number): number {
  const lim = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 200
  return Math.max(1, Math.min(5000, lim))
}

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

export function ScrapingPage() {
  const [kind, setKind] = useState<'followers' | 'following'>('followers')
  const [autoMode, setAutoMode] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [targetUsername, setTargetUsername] = useState('')
  const [limit, setLimit] = useState('200')
  const [taskName, setTaskName] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isOutputOpen, setIsOutputOpen] = useState(false)
  const [outputTitle, setOutputTitle] = useState('')
  const [outputPayload, setOutputPayload] = useState<unknown>(null)
  const [selectedId, setSelectedId] = useState<Id<'scrapingTasks'> | null>(null)
  const [deleteId, setDeleteId] = useState<Id<'scrapingTasks'> | null>(null)
  const [runningId, setRunningId] = useState<Id<'scrapingTasks'> | null>(null)

  const [eligibleProfiles, setEligibleProfiles] = useState<EligibleProfile[]>([])
  const [eligibleLoading, setEligibleLoading] = useState(false)
  const [eligibleError, setEligibleError] = useState<string | null>(null)

  const refreshEligibleProfiles = useCallback(async () => {
    setEligibleLoading(true)
    setEligibleError(null)
    try {
      const data = await apiFetch<{ profiles: EligibleProfile[] }>('/api/scraping/eligible-profiles')
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

  const eligibleSet = useMemo(() => new Set(eligibleProfiles.map((p) => p.id)), [eligibleProfiles])

  useEffect(() => {
    if (autoMode) return
    if (!selectedProfileId) return
    if (eligibleSet.size === 0) return
    if (!eligibleSet.has(selectedProfileId)) setSelectedProfileId('')
  }, [autoMode, eligibleSet, selectedProfileId])

  const tasks = useQuery(api.scrapingTasks.list, {}) as Doc<'scrapingTasks'>[] | undefined
  const createTaskMutation = useMutation(api.scrapingTasks.create)
  const updateTaskMutation = useMutation(api.scrapingTasks.update)
  const removeTaskMutation = useMutation(api.scrapingTasks.remove)
  const setTaskStatusMutation = useMutation(api.scrapingTasks.setStatus)

  const tasksList = useMemo(() => tasks ?? [], [tasks])
  const tasksLoading = tasks === undefined

  const canCreate = useMemo(() => {
    if (parseTargets(targetUsername).length === 0) return false
    if (!autoMode && !selectedProfileId) return false
    if (!autoMode && selectedProfileId && !eligibleSet.has(selectedProfileId)) return false
    return true
  }, [autoMode, eligibleSet, selectedProfileId, targetUsername])

  const [editKind, setEditKind] = useState<'followers' | 'following'>('followers')
  const [editAutoMode, setEditAutoMode] = useState(false)
  const [editSelectedProfileId, setEditSelectedProfileId] = useState<string>('')
  const [editTargetUsername, setEditTargetUsername] = useState('')
  const [editLimit, setEditLimit] = useState('200')
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

  const handleOpenEdit = useCallback(
    (task: Doc<'scrapingTasks'>) => {
      setSelectedId(task._id)
      setIsEditOpen(true)
      setError(null)

      const taskKind = task.kind === 'following' ? 'following' : 'followers'
      const mode = task.mode === 'manual' ? 'manual' : 'auto'
      setEditKind(taskKind)
      setEditAutoMode(mode === 'auto')
      setEditSelectedProfileId(typeof task.profileId === 'string' ? task.profileId : '')
      setEditTargetUsername(String(task.targetUsername || ''))
      setEditLimit(String(task.limit ?? 200))
      setEditTaskName(String(task.name || ''))
    },
    []
  )

  const handleCloseEdit = useCallback(() => {
    setIsEditOpen(false)
    setError(null)
  }, [])

  const canSaveEdit = useMemo(() => {
    if (!isEditOpen) return false
    if (!editTaskName.trim()) return false
    if (parseTargets(editTargetUsername).length === 0) return false
    if (!editAutoMode && !editSelectedProfileId) return false
    if (!editAutoMode && editSelectedProfileId && !eligibleSet.has(editSelectedProfileId)) return false
    return true
  }, [editAutoMode, editSelectedProfileId, editTargetUsername, editTaskName, eligibleSet, isEditOpen])

  const handleCreateTask = useCallback(async () => {
    if (!canCreate) return
    const targets = parseTargets(targetUsername)
    const firstTarget = targets[0] || ''
    if (!firstTarget) return
    const packedTargets = targets.join('\n')

    const effectiveLimit = clampLimit(limit)
    const baseName = String(taskName || '').trim()

    try {
      const name = baseName ? baseName : `${firstTarget} ${kind}`
      const created = await createTaskMutation({
        name,
        kind,
        mode: autoMode ? 'auto' : 'manual',
        ...(autoMode ? {} : { profileId: selectedProfileId }),
        targetUsername: packedTargets,
        limit: effectiveLimit,
      })
      setIsCreateOpen(false)
      if (created?._id) setSelectedId(created._id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [autoMode, canCreate, createTaskMutation, kind, limit, selectedProfileId, taskName, targetUsername])

  const handleRunTask = useCallback(
    async (task: Doc<'scrapingTasks'>, opts?: { resume?: boolean }) => {
      if (runningId) return

      const taskMode = task.mode === 'manual' ? 'manual' : 'auto'
      const taskTargets = parseTargets(String(task.targetUsername || ''))
      if (taskTargets.length === 0) return

      const taskProfileId = typeof task.profileId === 'string' ? task.profileId : ''
      if (taskMode === 'manual' && (!taskProfileId || !eligibleSet.has(taskProfileId))) {
        setError('Selected profile is not eligible.')
        return
      }

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
      const apiEndpoint = taskKind === 'following' ? '/api/scraping/following-chunk' : '/api/scraping/followers-chunk'
      const resume = Boolean(opts?.resume)
      const existingResumeState = (() => {
        if (!task.lastOutput || typeof task.lastOutput !== 'object') return undefined
        const r = task.lastOutput as Record<string, unknown>
        return r.resumeState
      })()

      try {
        const startedAt = Date.now()
        let lastOutput: unknown = null
        let lastStorageId: unknown = task.storageId
        let resumeState: unknown = resume ? existingResumeState : undefined
        let done = false
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

        const maxIterations = 50
        for (let i = 0; i < maxIterations; i++) {
          if (Date.now() - startedAt > 110000) break

          let output: unknown
          try {
            output = await apiFetchWithRetry<unknown>(apiEndpoint, {
              method: 'POST',
              body: {
                ...(taskMode === 'auto' ? { distribution: 'auto' } : { profileId: taskProfileId }),
                targetUsernames: taskTargets,
                limit: clampLimit(task.limit),
                taskId: task._id,
                resume: resume || i > 0,
                ...((resume || i > 0) ? { resumeState, storageId: lastStorageId } : {}),
                chunkLimit,
                maxPages,
              },
              timeout: 45000,
              maxRetries: 2,
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            const lower = msg.toLowerCase()
            const looksLike504 = lower.includes('504') || lower.includes('gateway time-out') || lower.includes('gateway timeout')
            if (looksLike504 && (chunkLimit > 25 || maxPages > 1)) {
              chunkLimit = Math.max(25, Math.min(chunkLimit, 50))
              maxPages = 1
              output = await apiFetchWithRetry<unknown>(apiEndpoint, {
                method: 'POST',
                body: {
                  ...(taskMode === 'auto' ? { distribution: 'auto' } : { profileId: taskProfileId }),
                  targetUsernames: taskTargets,
                  limit: clampLimit(task.limit),
                  taskId: task._id,
                  resume: resume || i > 0,
                  ...((resume || i > 0) ? { resumeState, storageId: lastStorageId } : {}),
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

          await setTaskStatusMutation({
            id: task._id,
            status: done ? 'completed' : 'running',
            lastRunAt: startAt,
            lastScraped: undefined,
            lastError: undefined,
            lastOutput,
          })

          if (done) break
          await new Promise((r) => setTimeout(r, 250))
        }

        const getLastScraped = (res: unknown): number | undefined => {
          if (!res || typeof res !== 'object') return undefined
          const r = res as Record<string, unknown>
          const v = typeof r.totalStored === 'number' ? r.totalStored : typeof r.totalScraped === 'number' ? r.totalScraped : typeof r.scraped === 'number' ? r.scraped : undefined
          return typeof v === 'number' && Number.isFinite(Number(v)) ? Number(v) : undefined
        }

        const lastScraped = getLastScraped(lastOutput)
        await setTaskStatusMutation({
          id: task._id,
          status: done ? 'completed' : 'paused',
          lastRunAt: startAt,
          lastScraped,
          lastError: undefined,
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
    [eligibleSet, runningId, setTaskStatusMutation]
  )

  const handleViewOutput = useCallback(
    (task: Doc<'scrapingTasks'>) => {
      const output = task.lastOutput ?? task.lastError
      setOutputTitle(task.name)
      setOutputPayload(output)
      setIsOutputOpen(true)
    },
    []
  )

  const refreshAll = useCallback(async () => {
    await refreshEligibleProfiles()
  }, [refreshEligibleProfiles])

  const selected = useMemo(() => tasksList.find((t) => t._id === selectedId) ?? null, [selectedId, tasksList])

  const handleConfirmDelete = useCallback(async () => {
    const id = deleteId
    if (!id) return
    try {
      await removeTaskMutation({ id })
      setDeleteId(null)
      if (selectedId === id) setSelectedId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [deleteId, removeTaskMutation, selectedId])

  const handleSaveEdit = useCallback(async () => {
    if (!selectedId) return
    if (!canSaveEdit) return

    const cleanedName = editTaskName.trim()
    const cleanedTargets = parseTargets(editTargetUsername)
    const packedTargets = cleanedTargets.join('\n')
    if (!packedTargets) return
    const safeLimit = clampLimit(editLimit)

    try {
      await updateTaskMutation({
        id: selectedId,
        name: cleanedName,
        kind: editKind,
        mode: editAutoMode ? 'auto' : 'manual',
        ...(editAutoMode ? {} : { profileId: editSelectedProfileId }),
        targetUsername: packedTargets,
        limit: safeLimit,
      })
      setIsEditOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [canSaveEdit, editAutoMode, editKind, editLimit, editSelectedProfileId, editTargetUsername, editTaskName, selectedId, updateTaskMutation])

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-2xl font-bold tracking-tight">Scraping Tasks</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refreshAll()} disabled={eligibleLoading || Boolean(runningId)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${eligibleLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button size="sm" onClick={handleOpenCreate} disabled={eligibleLoading || Boolean(runningId)}>
            <Plus className="mr-2 h-4 w-4" />
            Create task
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive text-sm border-b border-destructive/20">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 bg-muted/10">
        {eligibleError && (
          <div className="mb-4 p-3 rounded-md border bg-destructive/10 text-destructive text-sm">{eligibleError}</div>
        )}

        {tasksLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading tasks...</div>
        ) : tasksList.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No tasks found. Create one to get started.</div>
        ) : (
          <TasksTable
            tasks={tasksList}
            selectedId={selectedId}
            onSelect={setSelectedId}
            eligibleProfiles={eligibleProfiles}
            running={Boolean(runningId)}
            onRun={(task) => void handleRunTask(task, { resume: false })}
            onResume={(task) => void handleRunTask(task, { resume: true })}
            onEdit={handleOpenEdit}
            onViewOutput={handleViewOutput}
            onDelete={(task) => {
              setDeleteId(task._id)
              setSelectedId(task._id)
            }}
          />
        )}
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
        autoMode={autoMode}
        onAutoModeChange={setAutoMode}
        selectedProfileId={selectedProfileId}
        onSelectedProfileIdChange={setSelectedProfileId}
        targetUsername={targetUsername}
        onTargetUsernameChange={setTargetUsername}
        limit={limit}
        onLimitChange={setLimit}
        eligibleProfiles={eligibleProfiles}
        eligibleSet={eligibleSet}
        eligibleLoading={eligibleLoading}
        submitLabel="Create"
        submitDisabled={!canCreate}
        disabled={Boolean(runningId)}
        onCancel={handleCloseCreate}
        onSubmit={() => void handleCreateTask()}
      />

      <TaskDialog
        open={isEditOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseEdit()
          else setIsEditOpen(true)
        }}
        title="Edit scraping task"
        idPrefix="edit_scraping_task"
        taskName={editTaskName}
        onTaskNameChange={setEditTaskName}
        kind={editKind}
        onKindChange={setEditKind}
        autoMode={editAutoMode}
        onAutoModeChange={setEditAutoMode}
        selectedProfileId={editSelectedProfileId}
        onSelectedProfileIdChange={setEditSelectedProfileId}
        targetUsername={editTargetUsername}
        onTargetUsernameChange={setEditTargetUsername}
        limit={editLimit}
        onLimitChange={setEditLimit}
        eligibleProfiles={eligibleProfiles}
        eligibleSet={eligibleSet}
        eligibleLoading={eligibleLoading}
        submitLabel="Save"
        submitDisabled={!canSaveEdit}
        disabled={Boolean(runningId)}
        onCancel={handleCloseEdit}
        onSubmit={() => void handleSaveEdit()}
      />

      <OutputDialog open={isOutputOpen} onOpenChange={setIsOutputOpen} title={outputTitle} output={outputPayload} />

      <DeleteTaskDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        taskName={selected?.name ?? 'this task'}
        disabled={Boolean(runningId) || !deleteId}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  )
}
