import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
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
  const [autoMode, setAutoMode] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [targetUsername, setTargetUsername] = useState('')
  const [limit, setLimit] = useState('200')
  const [limitPerProfile, setLimitPerProfile] = useState('')
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

  const tasks = useQuery(api.scrapingTasks.list, { kind: 'followers' }) as Doc<'scrapingTasks'>[] | undefined
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

  const [editAutoMode, setEditAutoMode] = useState(false)
  const [editSelectedProfileId, setEditSelectedProfileId] = useState<string>('')
  const [editTargetUsername, setEditTargetUsername] = useState('')
  const [editLimit, setEditLimit] = useState('200')
  const [editLimitPerProfile, setEditLimitPerProfile] = useState('')
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

      const mode = task.mode === 'manual' ? 'manual' : 'auto'
      setEditAutoMode(mode === 'auto')
      setEditSelectedProfileId(typeof task.profileId === 'string' ? task.profileId : '')
      setEditTargetUsername(String(task.targetUsername || ''))
      setEditLimit(String(task.limit ?? 200))
      setEditLimitPerProfile(
        mode === 'auto'
          ? typeof task.limitPerProfile === 'number'
            ? String(task.limitPerProfile)
            : eligibleProfiles.length > 0
              ? String(Math.ceil((task.limit ?? 200) / eligibleProfiles.length))
              : ''
          : ''
      )
      setEditTaskName(String(task.name || ''))
    },
    [eligibleProfiles.length]
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

    const perProfile = autoMode && limitPerProfile.trim() ? clampLimit(limitPerProfile) : null
    const effectiveLimit = autoMode && perProfile ? clampLimit(perProfile * Math.max(1, eligibleProfiles.length)) : clampLimit(limit)
    const baseName = String(taskName || '').trim()

    try {
      const name = baseName ? baseName : `${firstTarget} followers`
      const created = await createTaskMutation({
        name,
        kind: 'followers',
        mode: autoMode ? 'auto' : 'manual',
        ...(autoMode ? {} : { profileId: selectedProfileId }),
        targetUsername: packedTargets,
        limit: effectiveLimit,
        ...(autoMode && perProfile ? { limitPerProfile: perProfile } : {}),
      })
      setIsCreateOpen(false)
      if (created?._id) setSelectedId(created._id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [autoMode, canCreate, createTaskMutation, eligibleProfiles.length, limit, limitPerProfile, selectedProfileId, taskName, targetUsername])

  const handleRunTask = useCallback(
    async (task: Doc<'scrapingTasks'>) => {
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

      try {
        const output = await apiFetch<unknown>('/api/scraping/followers', {
          method: 'POST',
          body: {
            ...(taskMode === 'auto' ? { distribution: 'auto' } : { profileId: taskProfileId }),
            targetUsernames: taskTargets,
            limit: clampLimit(task.limit),
            ...(taskMode === 'auto' && typeof task.limitPerProfile === 'number'
              ? { limitPerProfile: clampLimit(task.limitPerProfile) }
              : {}),
          },
          timeout: 120000,
        })

        const getLastScraped = (res: unknown): number | undefined => {
          if (!res || typeof res !== 'object') return undefined
          const r = res as Record<string, unknown>
          const v = typeof r.totalScraped === 'number' ? r.totalScraped : typeof r.scraped === 'number' ? r.scraped : undefined
          return typeof v === 'number' && Number.isFinite(Number(v)) ? Number(v) : undefined
        }

        const hasFailures = (): boolean => {
          if (!output || typeof output !== 'object') return false
          const r = output as Record<string, unknown>
          return Boolean(r.partial) || (typeof r.failures === 'number' && r.failures > 0)
        }

        const hasSuccess = (): boolean => {
          if (!output || typeof output !== 'object') return true
          const r = output as Record<string, unknown>
          if (!Array.isArray(r.perTarget)) return true
          return r.perTarget.some((v) => {
            if (!v || typeof v !== 'object') return false
            const o = v as Record<string, unknown>
            return o.ok === true
          })
        }

        const lastScraped = getLastScraped(output)
        const ok = !hasFailures()
        const anyOk = hasSuccess()
        await setTaskStatusMutation({
          id: task._id,
          status: anyOk ? 'completed' : 'failed',
          lastRunAt: startAt,
          lastScraped: anyOk ? lastScraped : undefined,
          lastError: ok ? undefined : anyOk ? 'Some targets failed.' : 'All targets failed.',
          lastOutput: output,
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
    const perProfile = editAutoMode && editLimitPerProfile.trim() ? clampLimit(editLimitPerProfile) : null
    const safeLimit = editAutoMode && perProfile ? clampLimit(perProfile * Math.max(1, eligibleProfiles.length)) : clampLimit(editLimit)

    try {
      await updateTaskMutation({
        id: selectedId,
        name: cleanedName,
        mode: editAutoMode ? 'auto' : 'manual',
        ...(editAutoMode ? {} : { profileId: editSelectedProfileId }),
        targetUsername: packedTargets,
        limit: safeLimit,
        ...(editAutoMode && perProfile ? { limitPerProfile: perProfile } : { limitPerProfile: undefined }),
      })
      setIsEditOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [canSaveEdit, editAutoMode, editLimit, editLimitPerProfile, editSelectedProfileId, editTargetUsername, editTaskName, eligibleProfiles.length, selectedId, updateTaskMutation])

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
            onRun={(task) => void handleRunTask(task)}
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
        autoMode={autoMode}
        onAutoModeChange={setAutoMode}
        selectedProfileId={selectedProfileId}
        onSelectedProfileIdChange={setSelectedProfileId}
        targetUsername={targetUsername}
        onTargetUsernameChange={setTargetUsername}
        limit={limit}
        onLimitChange={setLimit}
        limitPerProfile={limitPerProfile}
        onLimitPerProfileChange={setLimitPerProfile}
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
        autoMode={editAutoMode}
        onAutoModeChange={setEditAutoMode}
        selectedProfileId={editSelectedProfileId}
        onSelectedProfileIdChange={setEditSelectedProfileId}
        targetUsername={editTargetUsername}
        onTargetUsernameChange={setEditTargetUsername}
        limit={editLimit}
        onLimitChange={setEditLimit}
        limitPerProfile={editLimitPerProfile}
        onLimitPerProfileChange={setEditLimitPerProfile}
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
