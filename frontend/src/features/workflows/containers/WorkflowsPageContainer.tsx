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
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, RefreshCw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { getActivityById } from '@/features/workflows/activities'
import { WorkflowsList } from '../components/WorkflowsList'
import { WorkflowDialog } from '../components/WorkflowDialog'
import { WorkflowDetails } from '../components/WorkflowDetails'
import { ScheduleDialog } from '../components/ScheduleDialog'
import type { Workflow } from '../types'
import {
  buildWorkflowExportEnvelope,
  validateWorkflowImport,
} from '../utils/workflowImportExport'
import { AmbientGlow } from '@/components/ui/ambient-glow'

export function WorkflowsPageContainer() {
  const convex = useConvex()
  const navigate = useNavigate()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editWorkflowId, setEditWorkflowId] = useState<Id<'workflows'> | null>(
    null,
  )
  const [detailsWorkflowId, setDetailsWorkflowId] = useState<
    Id<'workflows'> | null
  >(null)
  const [scheduleWorkflowId, setScheduleWorkflowId] = useState<
    Id<'workflows'> | null
  >(null)
  const [deleteWorkflowId, setDeleteWorkflowId] = useState<
    Id<'workflows'> | null
  >(null)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workflowsData, setWorkflowsData] = useState<Workflow[] | null>(null)

  const workflows = useQuery(api.workflows.list, {})
  const lists = useQuery(api.lists.list, {})
  const workflowsLoading = workflows === undefined && workflowsData === null
  const workflowsList = useMemo(() => workflowsData ?? [], [workflowsData])

  useEffect(() => {
    if (workflows !== undefined) {
      setWorkflowsData(workflows)
    }
  }, [workflows])

  const createWorkflow = useMutation(api.workflows.create)
  const updateWorkflow = useMutation(api.workflows.update)
  const removeWorkflow = useMutation(api.workflows.remove)
  const duplicateWorkflow = useMutation(api.workflows.duplicate)
  const toggleActiveWorkflow = useMutation(api.workflows.toggleActive)
  const updateSchedule = useMutation(api.workflows.updateSchedule)
  const resetWorkflow = useMutation(api.workflows.reset)

  const editWorkflow =
    workflowsList.find((workflow) => workflow._id === editWorkflowId) ?? null
  const detailsWorkflow =
    workflowsList.find((workflow) => workflow._id === detailsWorkflowId) ?? null
  const scheduleWorkflow =
    workflowsList.find((workflow) => workflow._id === scheduleWorkflowId) ??
    null
  const deleteWorkflow =
    workflowsList.find((workflow) => workflow._id === deleteWorkflowId) ?? null

  useEffect(() => {
    if (editWorkflowId && !editWorkflow) {
      setEditWorkflowId(null)
    }
    if (detailsWorkflowId && !detailsWorkflow) {
      setDetailsWorkflowId(null)
    }
    if (scheduleWorkflowId && !scheduleWorkflow) {
      setScheduleWorkflowId(null)
    }
    if (deleteWorkflowId && !deleteWorkflow) {
      setDeleteWorkflowId(null)
    }
  }, [
    deleteWorkflow,
    deleteWorkflowId,
    detailsWorkflow,
    detailsWorkflowId,
    editWorkflow,
    editWorkflowId,
    scheduleWorkflow,
    scheduleWorkflowId,
  ])

  const handleCreate = useCallback(() => {
    setIsCreateOpen(true)
    setError(null)
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const [latest] = await Promise.all([
        convex.query(api.workflows.list, {}),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ])
      setWorkflowsData(latest as Workflow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }, [convex])

  const handleEdit = useCallback((workflow: Workflow) => {
    setEditWorkflowId(workflow._id)
    setError(null)
  }, [])

  const handleViewDetails = useCallback((workflow: Workflow) => {
    setDetailsWorkflowId(workflow._id)
    setError(null)
  }, [])

  const handleEditFlow = useCallback((workflow: Workflow) => {
    navigate(`/workflows/${workflow._id}/editor`)
    setError(null)
  }, [navigate])

  const handleSaveCreate = useCallback(
    async (data: { name: string }) => {
      setSaving(true)
      setError(null)
      try {
        await createWorkflow({
          name: data.name,
          nodes: [],
          edges: [],
        })
        setIsCreateOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    },
    [createWorkflow],
  )

  const handleSaveEdit = useCallback(
    async (data: { name: string }) => {
      if (!editWorkflowId) return
      setSaving(true)
      setError(null)
      try {
        await updateWorkflow({
          id: editWorkflowId,
          name: data.name,
        })
        setEditWorkflowId(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    },
    [editWorkflowId, updateWorkflow],
  )

  const handleDelete = useCallback((workflow: Workflow) => {
    setDeleteWorkflowId(workflow._id)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteWorkflowId) return
    setSaving(true)
    setError(null)
    try {
      await removeWorkflow({ id: deleteWorkflowId })
      if (editWorkflowId === deleteWorkflowId) {
        setEditWorkflowId(null)
      }
      if (detailsWorkflowId === deleteWorkflowId) {
        setDetailsWorkflowId(null)
      }
      if (scheduleWorkflowId === deleteWorkflowId) {
        setScheduleWorkflowId(null)
      }
      setDeleteWorkflowId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [
    deleteWorkflowId,
    detailsWorkflowId,
    editWorkflowId,
    removeWorkflow,
    scheduleWorkflowId,
  ])

  const handleDuplicate = useCallback(
    async (workflow: Workflow) => {
      setSaving(true)
      setError(null)
      try {
        await duplicateWorkflow({ id: workflow._id })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    },
    [duplicateWorkflow],
  )

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
        workflow.name
          .replace(/[^a-zA-Z0-9-_]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'workflow'
      link.href = url
      link.download = `${safeName}.workflow.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success(`Exported "${workflow.name}"`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click()
  }, [])

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      setSaving(true)
      setError(null)
      try {
        const rawText = await file.text()
        const imported = validateWorkflowImport({
          fileName: file.name,
          fileSizeBytes: file.size,
          rawText,
          existingWorkflowNames: workflowsList.map((workflow) => workflow.name),
          existingListIds: (lists ?? []).map((list) => String(list._id)),
          resolveActivityById: getActivityById,
        })

        await createWorkflow(imported.workflow)

        imported.warnings.forEach((warning) => toast.warning(warning))
        toast.success(`Imported "${imported.workflow.name}"`)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setError(message)
        toast.error(message)
      } finally {
        setSaving(false)
      }
    },
    [createWorkflow, lists, workflowsList],
  )

  const handleToggleActive = useCallback(
    async (workflow: Workflow) => {
      setError(null)
      try {
        if (workflow.isActive && workflow.status === 'running') {
          try {
            await apiFetch('/api/workflows/stop', {
              method: 'POST',
              body: { workflowId: workflow._id },
            })
          } catch (e) {
            void e
          }
        }
        await toggleActiveWorkflow({ id: workflow._id })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [toggleActiveWorkflow],
  )

  const handleStopRun = useCallback(async (workflow: Workflow) => {
    setError(null)
    try {
      await apiFetch('/api/workflows/stop', {
        method: 'POST',
        body: { workflowId: workflow._id },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const handleEditSchedule = useCallback((workflow: Workflow) => {
    setScheduleWorkflowId(workflow._id)
    setError(null)
  }, [])

  const handleSaveSchedule = useCallback(
    async (data: {
      scheduleType:
      | 'interval'
      | 'daily'
      | 'weekly'
      | 'monthly'
      | 'cron'
      | 'instant'
      scheduleConfig: {
        intervalMs?: number
        hourUTC?: number
        minuteUTC?: number
        daysOfWeek?: number[]
        dayOfMonth?: number
        cronspec?: string
      }
      maxRunsPerDay?: number
      timezone?: string
    }) => {
      if (!scheduleWorkflowId) return
      setSaving(true)
      setError(null)
      try {
        await updateSchedule({
          id: scheduleWorkflowId,
          scheduleType: data.scheduleType,
          scheduleConfig: data.scheduleConfig,
          maxRunsPerDay: data.maxRunsPerDay,
          timezone: data.timezone,
        })
        setScheduleWorkflowId(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    },
    [scheduleWorkflowId, updateSchedule],
  )

  const handleReset = useCallback(
    async (workflow: Workflow) => {
      setError(null)
      try {
        await resetWorkflow({ id: workflow._id })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [resetWorkflow],
  )

  return (
    <div className="bg-shell text-ink relative flex h-full flex-col overflow-hidden">
      <AmbientGlow />

      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
            <Button
              size="icon"
              onClick={handleCreate}
              disabled={saving}
              className="mobile-effect-shadow brand-button h-8 w-auto px-3.5 text-sm font-medium"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Workflow
            </Button>
            <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => void handleRefresh()}
                disabled={workflowsLoading || saving || refreshing}
                aria-label="Refresh workflows"
                title="Refresh workflows"
                className="h-8 w-8 shrink-0 p-0"
              >
                <RefreshCw
                  className={
                    workflowsLoading || refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'
                  }
                />
                <span className="sr-only">Refresh</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleImportClick}
                disabled={saving}
                className="h-8 w-auto px-3.5 text-sm font-medium"
              >
                <Upload className="mr-2 h-4 w-4" />
                <span>Import JSON</span>
              </Button>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void handleImportFile(event)}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-status-danger-soft text-status-danger border-status-danger-border relative z-10 flex-none border-b p-4 text-sm">
          {error}
        </div>
      )}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
          <WorkflowsList
            workflows={workflowsList}
            loading={workflowsLoading}
            onToggleActive={handleToggleActive}
            onStopRun={handleStopRun}
            onEdit={handleEdit}
            onEditFlow={handleEditFlow}
            onEditSchedule={handleEditSchedule}
            onDuplicate={handleDuplicate}
            onExport={handleExport}
            onDelete={handleDelete}
            onViewDetails={handleViewDetails}
          />
        </div>
      </div>

      <WorkflowDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        mode="create"
        saving={saving}
        onSave={handleSaveCreate}
        onCancel={() => setIsCreateOpen(false)}
      />

      <WorkflowDialog
        open={Boolean(editWorkflow)}
        onOpenChange={(open) => {
          if (!open) setEditWorkflowId(null)
        }}
        mode="edit"
        workflow={editWorkflow}
        saving={saving}
        onSave={handleSaveEdit}
        onCancel={() => setEditWorkflowId(null)}
      />

      <Sheet
        open={Boolean(detailsWorkflow)}
        onOpenChange={(open) => {
          if (!open) setDetailsWorkflowId(null)
        }}
      >
        <SheetContent className="bg-panel border-line text-ink w-full max-w-full border-l p-0 sm:w-[540px]">
          <SheetHeader className="border-line-soft bg-panel-subtle border-b p-6 pb-4">
            <SheetTitle className="text-ink">Workflow Details</SheetTitle>
          </SheetHeader>
          {detailsWorkflow ? (
            <WorkflowDetails
              workflow={detailsWorkflow}
              onToggleActive={() => handleToggleActive(detailsWorkflow)}
              onEditSchedule={() => handleEditSchedule(detailsWorkflow)}
              onReset={() => handleReset(detailsWorkflow)}
              onStopRun={() => handleStopRun(detailsWorkflow)}
            />
          ) : (
            <div className="text-muted-foreground p-8 text-center">
              Workflow unavailable.
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={Boolean(deleteWorkflowId)}
        onOpenChange={(open) => {
          if (!open) setDeleteWorkflowId(null)
        }}
      >
        <AlertDialogContent className="bg-panel border-line border shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-ink">
              Delete Workflow
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-copy">
              Are you sure you want to delete this workflow? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={saving}
            >
              {saving ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ScheduleDialog
        open={Boolean(scheduleWorkflow)}
        onOpenChange={(open) => {
          if (!open) setScheduleWorkflowId(null)
        }}
        workflow={scheduleWorkflow}
        saving={saving}
        onSave={handleSaveSchedule}
      />
    </div>
  )
}



