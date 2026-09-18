import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useNavigate } from '@/lib/router'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { getActivityById } from '@/features/automations/activities'
import type { Automation } from '../types'
import {
  buildAutomationExportEnvelope,
  validateAutomationImport,
} from '../utils/automationImportExport'
import { useErrorHandler } from '@/hooks/useErrorHandler'

/* ── Dialog state management ── */

function useAutomationDialogState(automationsList: Automation[]) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editAutomationId, setEditAutomationId] = useState<Id<'automations'> | null>(null)
  const [detailsAutomationId, setDetailsAutomationId] = useState<Id<'automations'> | null>(null)
  const [deleteAutomationId, setDeleteAutomationId] = useState<Id<'automations'> | null>(null)

  const editAutomation = useMemo(
    () => (editAutomationId ? automationsList.find((w) => w._id === editAutomationId) ?? null : null),
    [editAutomationId, automationsList],
  )
  const detailsAutomation = useMemo(
    () => (detailsAutomationId ? automationsList.find((w) => w._id === detailsAutomationId) ?? null : null),
    [detailsAutomationId, automationsList],
  )

  return {
    isCreateOpen, setIsCreateOpen,
    editAutomationId, setEditAutomationId,
    detailsAutomationId, setDetailsAutomationId,
    deleteAutomationId, setDeleteAutomationId,
    editAutomation, detailsAutomation,
  }
}

/* ── CRUD operations ── */

/* ── CRUD: simple actions ── */

/* ── CRUD: mutations ── */

function useAutomationMutations(
  dialogState: ReturnType<typeof useAutomationDialogState>,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const [saving, setSaving] = useState(false)
  const createAutomation = useMutation(api.automations.mutations.create)
  const updateAutomation = useMutation(api.automations.mutations.update)
  const removeAutomation = useMutation(api.automations.mutations.remove)
  const duplicateAutomation = useMutation(api.automations.mutations.duplicate)
  const resetAutomation = useMutation(api.automations.mutations.reset)

  const handleSaveCreate = useCallback(async (data: { name: string }) => {
    setSaving(true)
    try { await createAutomation({ name: data.name, nodes: [], edges: [] }); dialogState.setIsCreateOpen(false) }
    catch (e) { handleError(e, 'Create automation') }
    finally { setSaving(false) }
  }, [createAutomation, dialogState, handleError])

  const handleSaveEdit = useCallback(async (data: { name: string }) => {
    if (!dialogState.editAutomationId) return
    setSaving(true)
    try { await updateAutomation({ id: dialogState.editAutomationId, name: data.name }); dialogState.setEditAutomationId(null) }
    catch (e) { handleError(e, 'Update automation') }
    finally { setSaving(false) }
  }, [dialogState, handleError, updateAutomation])

  const handleConfirmDelete = useCallback(async () => {
    if (!dialogState.deleteAutomationId) return
    setSaving(true)
    try {
      await removeAutomation({ id: dialogState.deleteAutomationId })
      if (dialogState.editAutomationId === dialogState.deleteAutomationId) dialogState.setEditAutomationId(null)
      if (dialogState.detailsAutomationId === dialogState.deleteAutomationId) dialogState.setDetailsAutomationId(null)
      dialogState.setDeleteAutomationId(null)
    } catch (e) { handleError(e, 'Delete automation') }
    finally { setSaving(false) }
  }, [dialogState, removeAutomation, handleError])

  const handleDuplicate = useCallback(async (automation: Automation) => {
    setSaving(true)
    try { await duplicateAutomation({ id: automation._id }) }
    catch (e) { handleError(e, 'Duplicate automation') }
    finally { setSaving(false) }
  }, [duplicateAutomation, handleError])

  const handleReset = useCallback(async (automation: Automation) => {
    try { await resetAutomation({ id: automation._id }) }
    catch (e) { handleError(e, 'Reset automation') }
  }, [resetAutomation, handleError])

  return { saving, setSaving, createAutomation, handleSaveCreate, handleSaveEdit, handleConfirmDelete, handleDuplicate, handleReset }
}

/* ── CRUD operations (composed) ── */

/* ── Import/Export operations ── */

function useAutomationImportExport(
  automationsList: Automation[],
  createAutomation: ReturnType<typeof useMutation<typeof api.automations.mutations.create>>,
  setSaving: (s: boolean) => void,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const lists = useQuery(api.lists.list, {})

  const handleExport = useCallback((automation: Automation) => {
    try {
      const payload = buildAutomationExportEnvelope({
        name: automation.name,
        description: automation.description,
        nodes: automation.nodes,
        edges: automation.edges,
      })
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const safeName =
        automation.name.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '') || 'automation'
      link.href = url
      link.download = `${safeName}.automation.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success(`Exported "${automation.name}"`)
    } catch (e) {
      handleError(e, 'Export automation')
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
      const imported = validateAutomationImport({
        fileName: file.name,
        fileSizeBytes: file.size,
        rawText,
        existingAutomationNames: automationsList.map((w) => w.name),
        existingListIds: (lists ?? []).map((list) => String(list._id)),
        resolveActivityById: getActivityById,
      })
      await createAutomation(imported.automation)
      imported.warnings.forEach((warning) => toast.warning(warning))
      toast.success(`Imported "${imported.automation.name}"`)
    } catch (e) {
      handleError(e, 'Import automation')
    } finally {
      setSaving(false)
    }
  }, [createAutomation, lists, automationsList, handleError, setSaving])

  return {
    importInputRef, lists,
    handleExport, handleImportClick, handleImportFile,
  }
}

/* ── Active toggle & runs ── */

function useAutomationRuns(
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const setActiveAutomation = useMutation(api.automations.mutations.setActive)

  const handleToggleActive = useCallback(async (automation: Automation) => {
    try {
      const nextActive = !(automation.isActive ?? true)
      if (!nextActive && automation.status === 'running') {
        await apiFetch('/api/automations/stop', {
          method: 'POST',
          body: { automationId: automation._id },
        })
      }
      await setActiveAutomation({ id: automation._id, isActive: nextActive })
    } catch (e) {
      handleError(e, 'Toggle automation')
    }
  }, [handleError, setActiveAutomation])

  const handleRun = useCallback(async (automation: Automation) => {
    try {
      await apiFetch('/api/automations/run', { method: 'POST', body: { automationId: automation._id } })
    } catch (e) {
      handleError(e, 'Run automation')
    }
  }, [handleError])

  const handleStopRun = useCallback(async (automation: Automation) => {
    try {
      await apiFetch('/api/automations/stop', { method: 'POST', body: { automationId: automation._id } })
    } catch (e) {
      handleError(e, 'Stop automation')
    }
  }, [handleError])

  return {
    handleToggleActive, handleRun, handleStopRun,
  }
}

/* ── Main hook ── */

/* ── Automations data hook ── */

function useAutomationsData() {
  const automations = useQuery(api.automations.queries.list, {})
  const automationsLoading = automations === undefined
  const automationsList = useMemo(() => automations ?? [], [automations])

  return { automationsList, automationsLoading }
}

/* ── Main hook ── */

export function useAutomationsPage() {
  const { handleError } = useErrorHandler()

  const { automationsList, automationsLoading } = useAutomationsData()
  const dialogState = useAutomationDialogState(automationsList)

  const crud = useAutomationMutations(dialogState, handleError)
  const navigate = useNavigate()

  const handleCreate = useCallback(() => {
    dialogState.setIsCreateOpen(true)
  }, [dialogState])

  const handleEdit = useCallback((automation: Automation) => {
    dialogState.setEditAutomationId(automation._id)
  }, [dialogState])

  const handleViewDetails = useCallback((automation: Automation) => {
    dialogState.setDetailsAutomationId(automation._id)
  }, [dialogState])

  const handleEditFlow = useCallback((automation: Automation) => {
    navigate(`/automations/${automation._id}/editor`)
  }, [navigate])

  const handleDelete = useCallback((automation: Automation) => {
    dialogState.setDeleteAutomationId(automation._id)
  }, [dialogState])


  const importExport = useAutomationImportExport(automationsList, crud.createAutomation, crud.setSaving, handleError)
  const runs = useAutomationRuns(handleError)

  return {
    importInputRef: importExport.importInputRef,
    automationsList, automationsLoading, saving: crud.saving,
    isCreateOpen: dialogState.isCreateOpen, editAutomation: dialogState.editAutomation,
    detailsAutomation: dialogState.detailsAutomation,
    deleteAutomationId: dialogState.deleteAutomationId,
    setIsCreateOpen: dialogState.setIsCreateOpen, setEditAutomationId: dialogState.setEditAutomationId,
    setDetailsAutomationId: dialogState.setDetailsAutomationId,
    setDeleteAutomationId: dialogState.setDeleteAutomationId,
    handleCreate, handleEdit,
    handleViewDetails, handleEditFlow,
    handleSaveCreate: crud.handleSaveCreate, handleSaveEdit: crud.handleSaveEdit,
    handleDelete, handleConfirmDelete: crud.handleConfirmDelete,
    handleDuplicate: crud.handleDuplicate,
    handleExport: importExport.handleExport,
    handleImportClick: importExport.handleImportClick,
    handleImportFile: importExport.handleImportFile,
    handleToggleActive: runs.handleToggleActive,
    handleRun: runs.handleRun,
    handleStopRun: runs.handleStopRun,
    handleReset: crud.handleReset,
  }
}
