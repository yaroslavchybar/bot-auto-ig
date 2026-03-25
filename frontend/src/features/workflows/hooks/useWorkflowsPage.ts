import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { useNavigate } from 'react-router'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { toast } from 'sonner'
import { apiDownload, apiFetch } from '@/lib/api'
import { getActivityById } from '@/features/workflows/activities'
import type { Workflow } from '../types'
import {
  buildWorkflowExportEnvelope,
  validateWorkflowImport,
} from '../utils/workflowImportExport'
import { useErrorHandler } from '@/hooks/useErrorHandler'

type WorkflowArtifact = {
  _id: string
  name: string
  nodeLabel?: string | null
  kind: 'followers' | 'following'
  targets?: string[]
  targetUsername?: string | null
  status?: string | null
  storageId?: string | null
  manifestStorageId?: string | null
  exportStorageId?: string | null
  sourceProfileName?: string | null
  lastRunAt?: number | null
  stats?: {
    scraped?: number
    deduped?: number
    chunksCompleted?: number
    targetsCompleted?: number
  } | null
}

/* ── Dialog state management ── */

function useWorkflowDialogState(workflowsList: Workflow[]) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editWorkflowId, setEditWorkflowId] = useState<Id<'workflows'> | null>(null)
  const [detailsWorkflowId, setDetailsWorkflowId] = useState<Id<'workflows'> | null>(null)
  const [scheduleWorkflowId, setScheduleWorkflowId] = useState<Id<'workflows'> | null>(null)
  const [deleteWorkflowId, setDeleteWorkflowId] = useState<Id<'workflows'> | null>(null)

  const editWorkflow = useMemo(
    () => (editWorkflowId ? workflowsList.find((w) => w._id === editWorkflowId) ?? null : null),
    [editWorkflowId, workflowsList],
  )
  const detailsWorkflow = useMemo(
    () => (detailsWorkflowId ? workflowsList.find((w) => w._id === detailsWorkflowId) ?? null : null),
    [detailsWorkflowId, workflowsList],
  )
  const scheduleWorkflow = useMemo(
    () => (scheduleWorkflowId ? workflowsList.find((w) => w._id === scheduleWorkflowId) ?? null : null),
    [scheduleWorkflowId, workflowsList],
  )

  return {
    isCreateOpen, setIsCreateOpen,
    editWorkflowId, setEditWorkflowId,
    detailsWorkflowId, setDetailsWorkflowId,
    scheduleWorkflowId, setScheduleWorkflowId,
    deleteWorkflowId, setDeleteWorkflowId,
    editWorkflow, detailsWorkflow, scheduleWorkflow,
  }
}

/* ── Artifact fetching ── */

function useWorkflowArtifacts(
  detailsWorkflowId: Id<'workflows'> | null,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const [workflowArtifacts, setWorkflowArtifacts] = useState<
    Record<string, WorkflowArtifact[]>
  >({})
  const [fetchedIds, setFetchedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!detailsWorkflowId) return
    const id = String(detailsWorkflowId)
    let cancelled = false
    void apiFetch<WorkflowArtifact[]>(
      `/api/workflows/artifacts?workflowId=${encodeURIComponent(id)}`,
    )
      .then((rows) => {
        if (cancelled) return
        setWorkflowArtifacts((prev) => ({
          ...prev,
          [id]: Array.isArray(rows) ? rows : [],
        }))
        setFetchedIds((prev) => new Set(prev).add(id))
      })
      .catch((cause) => {
        if (cancelled) return
        handleError(cause, 'Workflow artifacts')
        setFetchedIds((prev) => new Set(prev).add(id))
      })
    return () => { cancelled = true }
  }, [detailsWorkflowId, handleError])

  const artifactsLoading = detailsWorkflowId !== null
    && !fetchedIds.has(String(detailsWorkflowId))

  return { artifactsLoading, workflowArtifacts }
}

/* ── CRUD operations ── */

/* ── CRUD: simple actions ── */

function useWorkflowSimpleActions(
  dialogState: ReturnType<typeof useWorkflowDialogState>,
) {
  const navigate = useNavigate()

  const handleCreate = useCallback(() => {
    dialogState.setIsCreateOpen(true)
  }, [dialogState])

  const handleEdit = useCallback((workflow: Workflow) => {
    dialogState.setEditWorkflowId(workflow._id)
  }, [dialogState])

  const handleViewDetails = useCallback((workflow: Workflow) => {
    dialogState.setDetailsWorkflowId(workflow._id)
  }, [dialogState])

  const handleEditFlow = useCallback((workflow: Workflow) => {
    navigate(`/workflows/${workflow._id}/editor`)
  }, [navigate])

  const handleDelete = useCallback((workflow: Workflow) => {
    dialogState.setDeleteWorkflowId(workflow._id)
  }, [dialogState])

  return { handleCreate, handleEdit, handleViewDetails, handleEditFlow, handleDelete }
}

/* ── CRUD: mutations ── */

function useWorkflowMutations(
  dialogState: ReturnType<typeof useWorkflowDialogState>,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const [saving, setSaving] = useState(false)
  const createWorkflow = useMutation(api.workflows.mutations.create)
  const updateWorkflow = useMutation(api.workflows.mutations.update)
  const removeWorkflow = useMutation(api.workflows.mutations.remove)
  const duplicateWorkflow = useMutation(api.workflows.mutations.duplicate)
  const resetWorkflow = useMutation(api.workflows.mutations.reset)

  const handleSaveCreate = useCallback(async (data: { name: string }) => {
    setSaving(true)
    try { await createWorkflow({ name: data.name, nodes: [], edges: [] }); dialogState.setIsCreateOpen(false) }
    catch (e) { handleError(e, 'Create workflow') }
    finally { setSaving(false) }
  }, [createWorkflow, dialogState, handleError])

  const handleSaveEdit = useCallback(async (data: { name: string }) => {
    if (!dialogState.editWorkflowId) return
    setSaving(true)
    try { await updateWorkflow({ id: dialogState.editWorkflowId, name: data.name }); dialogState.setEditWorkflowId(null) }
    catch (e) { handleError(e, 'Update workflow') }
    finally { setSaving(false) }
  }, [dialogState, handleError, updateWorkflow])

  const handleConfirmDelete = useCallback(async () => {
    if (!dialogState.deleteWorkflowId) return
    setSaving(true)
    try {
      await removeWorkflow({ id: dialogState.deleteWorkflowId })
      if (dialogState.editWorkflowId === dialogState.deleteWorkflowId) dialogState.setEditWorkflowId(null)
      if (dialogState.detailsWorkflowId === dialogState.deleteWorkflowId) dialogState.setDetailsWorkflowId(null)
      if (dialogState.scheduleWorkflowId === dialogState.deleteWorkflowId) dialogState.setScheduleWorkflowId(null)
      dialogState.setDeleteWorkflowId(null)
    } catch (e) { handleError(e, 'Delete workflow') }
    finally { setSaving(false) }
  }, [dialogState, removeWorkflow, handleError])

  const handleDuplicate = useCallback(async (workflow: Workflow) => {
    setSaving(true)
    try { await duplicateWorkflow({ id: workflow._id }) }
    catch (e) { handleError(e, 'Duplicate workflow') }
    finally { setSaving(false) }
  }, [duplicateWorkflow, handleError])

  const handleReset = useCallback(async (workflow: Workflow) => {
    try { await resetWorkflow({ id: workflow._id }) }
    catch (e) { handleError(e, 'Reset workflow') }
  }, [resetWorkflow, handleError])

  return { saving, setSaving, createWorkflow, handleSaveCreate, handleSaveEdit, handleConfirmDelete, handleDuplicate, handleReset }
}

/* ── CRUD operations (composed) ── */

function useWorkflowCrud(
  dialogState: ReturnType<typeof useWorkflowDialogState>,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const actions = useWorkflowSimpleActions(dialogState)
  const mutations = useWorkflowMutations(dialogState, handleError)

  return {
    saving: mutations.saving,
    setSaving: mutations.setSaving,
    createWorkflow: mutations.createWorkflow,
    ...actions,
    handleSaveCreate: mutations.handleSaveCreate,
    handleSaveEdit: mutations.handleSaveEdit,
    handleConfirmDelete: mutations.handleConfirmDelete,
    handleDuplicate: mutations.handleDuplicate,
    handleReset: mutations.handleReset,
  }
}

/* ── Import/Export operations ── */

function useWorkflowImportExport(
  workflowsList: Workflow[],
  createWorkflow: ReturnType<typeof useMutation<typeof api.workflows.mutations.create>>,
  setSaving: (s: boolean) => void,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const lists = useQuery(api.lists.list, {})

  const handleExport = useCallback((workflow: Workflow) => {
    try {
      const payload = buildWorkflowExportEnvelope({
        name: workflow.name,
        description: workflow.description,
        nodes: workflow.nodes,
        edges: workflow.edges,
      })
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const safeName =
        workflow.name.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '') || 'workflow'
      link.href = url
      link.download = `${safeName}.workflow.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success(`Exported "${workflow.name}"`)
    } catch (e) {
      handleError(e, 'Export workflow')
    }
  }, [handleError])

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click()
  }, [])

  const handleImportFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setSaving(true)
    try {
      const rawText = await file.text()
      const imported = validateWorkflowImport({
        fileName: file.name,
        fileSizeBytes: file.size,
        rawText,
        existingWorkflowNames: workflowsList.map((w) => w.name),
        existingListIds: (lists ?? []).map((list) => String(list._id)),
        resolveActivityById: getActivityById,
      })
      await createWorkflow(imported.workflow)
      imported.warnings.forEach((warning) => toast.warning(warning))
      toast.success(`Imported "${imported.workflow.name}"`)
    } catch (e) {
      handleError(e, 'Import workflow')
    } finally {
      setSaving(false)
    }
  }, [createWorkflow, lists, workflowsList, handleError, setSaving])

  return {
    importInputRef, lists,
    handleExport, handleImportClick, handleImportFile,
  }
}

/* ── Schedule & Active toggle ── */

interface ScheduleUpdateData {
  scheduleType: 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron' | 'instant'
  scheduleConfig: {
    intervalMs?: number; hourUTC?: number; minuteUTC?: number
    daysOfWeek?: number[]; dayOfMonth?: number; cronspec?: string
  }
  maxRunsPerDay?: number
  timezone?: string
}

function useWorkflowScheduling(
  dialogState: ReturnType<typeof useWorkflowDialogState>,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
  setSaving: (s: boolean) => void,
) {
  const toggleActiveWorkflow = useMutation(api.workflows.scheduling.toggleActive)
  const updateSchedule = useMutation(api.workflows.scheduling.updateSchedule)

  const handleToggleActive = useCallback(async (workflow: Workflow) => {
    try {
      if (workflow.isActive && workflow.status === 'running') {
        try {
          await apiFetch('/api/workflows/stop', { method: 'POST', body: { workflowId: workflow._id } })
        } catch { void 0 }
      }
      await toggleActiveWorkflow({ id: workflow._id })
    } catch (e) {
      handleError(e, 'Toggle workflow')
    }
  }, [handleError, toggleActiveWorkflow])

  const handleStopRun = useCallback(async (workflow: Workflow) => {
    try {
      await apiFetch('/api/workflows/stop', { method: 'POST', body: { workflowId: workflow._id } })
    } catch (e) {
      handleError(e, 'Stop workflow')
    }
  }, [handleError])

  const handleEditSchedule = useCallback((workflow: Workflow) => {
    dialogState.setScheduleWorkflowId(workflow._id)
  }, [dialogState])

  const handleSaveSchedule = useCallback(async (data: ScheduleUpdateData) => {
    if (!dialogState.scheduleWorkflowId) return
    setSaving(true)
    try {
      await updateSchedule({
        id: dialogState.scheduleWorkflowId,
        scheduleType: data.scheduleType,
        scheduleConfig: data.scheduleConfig,
        maxRunsPerDay: data.maxRunsPerDay,
        timezone: data.timezone,
      })
      dialogState.setScheduleWorkflowId(null)
    } catch (e) {
      handleError(e, 'Save schedule')
    } finally { setSaving(false) }
  }, [dialogState, handleError, setSaving, updateSchedule])

  return {
    handleToggleActive, handleStopRun,
    handleEditSchedule, handleSaveSchedule,
  }
}

/* ── Main hook ── */

/* ── Workflows data hook ── */

function useWorkflowsData() {
  const [overrideData, setOverrideData] = useState<Workflow[] | null>(null)
  const workflows = useQuery(api.workflows.queries.list, {})
  const resolved = overrideData ?? workflows
  const workflowsLoading = resolved === undefined
  const workflowsList = useMemo(() => resolved ?? [], [resolved])

  return { workflowsList, workflowsLoading, setWorkflowsData: setOverrideData }
}

/* ── Main hook ── */

export function useWorkflowsPage() {
  const convex = useConvex()
  const [refreshing, setRefreshing] = useState(false)
  const { handleError } = useErrorHandler()

  const { workflowsList, workflowsLoading, setWorkflowsData } = useWorkflowsData()
  const dialogState = useWorkflowDialogState(workflowsList)
  const { artifactsLoading, workflowArtifacts } =
    useWorkflowArtifacts(dialogState.detailsWorkflowId, handleError)

  const crud = useWorkflowCrud(dialogState, handleError)
  const importExport = useWorkflowImportExport(workflowsList, crud.createWorkflow, crud.setSaving, handleError)
  const scheduling = useWorkflowScheduling(dialogState, handleError, crud.setSaving)

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [latest] = await Promise.all([
        convex.query(api.workflows.queries.list, {}),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ])
      setWorkflowsData(latest as Workflow[])
    } catch (e) { handleError(e, 'Refresh workflows') }
    finally { setRefreshing(false) }
  }, [convex, handleError, setWorkflowsData])

  const handleDownloadArtifact = useCallback(async (storageId: string, fileName: string) => {
    try {
      await apiDownload(
        `/api/workflows/artifacts/download?storageId=${encodeURIComponent(storageId)}&fileName=${encodeURIComponent(fileName)}`,
        fileName,
      )
    } catch (e) { handleError(e, 'Download artifact') }
  }, [handleError])

  return {
    importInputRef: importExport.importInputRef,
    workflowsList, workflowsLoading, saving: crud.saving, refreshing,
    isCreateOpen: dialogState.isCreateOpen, editWorkflow: dialogState.editWorkflow,
    detailsWorkflow: dialogState.detailsWorkflow, scheduleWorkflow: dialogState.scheduleWorkflow,
    deleteWorkflowId: dialogState.deleteWorkflowId, artifactsLoading, workflowArtifacts,
    setIsCreateOpen: dialogState.setIsCreateOpen, setEditWorkflowId: dialogState.setEditWorkflowId,
    setDetailsWorkflowId: dialogState.setDetailsWorkflowId,
    setScheduleWorkflowId: dialogState.setScheduleWorkflowId,
    setDeleteWorkflowId: dialogState.setDeleteWorkflowId,
    handleCreate: crud.handleCreate, handleRefresh, handleEdit: crud.handleEdit,
    handleViewDetails: crud.handleViewDetails, handleEditFlow: crud.handleEditFlow,
    handleSaveCreate: crud.handleSaveCreate, handleSaveEdit: crud.handleSaveEdit,
    handleDelete: crud.handleDelete, handleConfirmDelete: crud.handleConfirmDelete,
    handleDuplicate: crud.handleDuplicate,
    handleExport: importExport.handleExport,
    handleImportClick: importExport.handleImportClick,
    handleImportFile: importExport.handleImportFile,
    handleToggleActive: scheduling.handleToggleActive,
    handleStopRun: scheduling.handleStopRun,
    handleEditSchedule: scheduling.handleEditSchedule,
    handleSaveSchedule: scheduling.handleSaveSchedule,
    handleReset: crud.handleReset, handleDownloadArtifact,
  }
}
