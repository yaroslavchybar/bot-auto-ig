import { Plus, RefreshCw, Upload } from 'lucide-react'
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
import { WorkflowsList } from '../components/WorkflowsList'
import { WorkflowDialog } from '../components/WorkflowDialog'
import { WorkflowDetails } from '../components/WorkflowDetails'
import { ScheduleDialog } from '../components/ScheduleDialog'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useWorkflowsPage } from '../hooks/useWorkflowsPage'

export function WorkflowsPageContainer() {
  const s = useWorkflowsPage()
  return (
    <div className="bg-shell text-ink relative flex h-full flex-col overflow-hidden">
      <AmbientGlow />
      <WorkflowsHeader saving={s.saving} workflowsLoading={s.workflowsLoading}
        refreshing={s.refreshing} importInputRef={s.importInputRef}
        onCreate={s.handleCreate} onRefresh={() => void s.handleRefresh()}
        onImportClick={s.handleImportClick} onImportFile={s.handleImportFile} />
      <WorkflowsContent s={s} />
      <WorkflowCrudDialogs isCreateOpen={s.isCreateOpen} editWorkflow={s.editWorkflow}
        saving={s.saving} onSetIsCreateOpen={s.setIsCreateOpen}
        onSetEditWorkflowId={s.setEditWorkflowId} onSaveCreate={s.handleSaveCreate}
        onSaveEdit={s.handleSaveEdit} />
      <WorkflowDetailsSheet detailsWorkflow={s.detailsWorkflow}
        artifactsLoading={s.artifactsLoading} workflowArtifacts={s.workflowArtifacts}
        onSetDetailsWorkflowId={s.setDetailsWorkflowId} onToggleActive={s.handleToggleActive}
        onEditSchedule={s.handleEditSchedule} onReset={s.handleReset}
        onStopRun={s.handleStopRun} onDownloadArtifact={s.handleDownloadArtifact} />
      <WorkflowDeleteDialog deleteWorkflowId={s.deleteWorkflowId} saving={s.saving}
        onSetDeleteWorkflowId={s.setDeleteWorkflowId} onConfirmDelete={s.handleConfirmDelete} />
      <ScheduleDialog open={Boolean(s.scheduleWorkflow)}
        onOpenChange={(open) => { if (!open) s.setScheduleWorkflowId(null) }}
        workflow={s.scheduleWorkflow} saving={s.saving} onSave={s.handleSaveSchedule} />
    </div>
  )
}

function WorkflowsContent({ s }: { s: ReturnType<typeof useWorkflowsPage> }) {
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <WorkflowsList workflows={s.workflowsList} loading={s.workflowsLoading}
          onToggleActive={s.handleToggleActive} onStopRun={s.handleStopRun}
          onEdit={s.handleEdit} onEditFlow={s.handleEditFlow}
          onEditSchedule={s.handleEditSchedule} onDuplicate={s.handleDuplicate}
          onExport={s.handleExport} onDelete={s.handleDelete}
          onViewDetails={s.handleViewDetails} />
      </div>
    </div>
  )
}

/* ── Header sub-component ── */

import type { ChangeEvent, RefObject } from 'react'

function WorkflowsHeader({
  saving,
  workflowsLoading,
  refreshing,
  importInputRef,
  onCreate,
  onRefresh,
  onImportClick,
  onImportFile,
}: {
  saving: boolean
  workflowsLoading: boolean
  refreshing: boolean
  importInputRef: RefObject<HTMLInputElement | null>
  onCreate: () => void
  onRefresh: () => void
  onImportClick: () => void
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <Button
            size="icon"
            onClick={onCreate}
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
              onClick={onRefresh}
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
              onClick={onImportClick}
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
            onChange={(event) => void onImportFile(event)}
          />
        </div>
      </div>
    </div>
  )
}

/* ── Crud Dialogs (Create + Edit) ── */

import type { Workflow } from '../types'

function WorkflowCrudDialogs({
  isCreateOpen,
  editWorkflow,
  saving,
  onSetIsCreateOpen,
  onSetEditWorkflowId,
  onSaveCreate,
  onSaveEdit,
}: {
  isCreateOpen: boolean
  editWorkflow: Workflow | null
  saving: boolean
  onSetIsCreateOpen: (open: boolean) => void
  onSetEditWorkflowId: (id: import('../../../../../convex/_generated/dataModel').Id<'workflows'> | null) => void
  onSaveCreate: (data: { name: string }) => void
  onSaveEdit: (data: { name: string }) => void
}) {
  return (
    <>
      <WorkflowDialog
        open={isCreateOpen}
        onOpenChange={onSetIsCreateOpen}
        mode="create"
        saving={saving}
        onSave={onSaveCreate}
        onCancel={() => onSetIsCreateOpen(false)}
      />

      <WorkflowDialog
        open={Boolean(editWorkflow)}
        onOpenChange={(open) => {
          if (!open) onSetEditWorkflowId(null)
        }}
        mode="edit"
        workflow={editWorkflow}
        saving={saving}
        onSave={onSaveEdit}
        onCancel={() => onSetEditWorkflowId(null)}
      />
    </>
  )
}

/* ── Details Sheet ── */

function WorkflowDetailsSheet({
  detailsWorkflow,
  artifactsLoading,
  workflowArtifacts,
  onSetDetailsWorkflowId,
  onToggleActive,
  onEditSchedule,
  onReset,
  onStopRun,
  onDownloadArtifact,
}: {
  detailsWorkflow: Workflow | null
  artifactsLoading: boolean
  workflowArtifacts: Record<string, { _id: string; name: string }[]>
  onSetDetailsWorkflowId: (id: import('../../../../../convex/_generated/dataModel').Id<'workflows'> | null) => void
  onToggleActive: (workflow: Workflow) => void
  onEditSchedule: (workflow: Workflow) => void
  onReset: (workflow: Workflow) => void
  onStopRun: (workflow: Workflow) => void
  onDownloadArtifact: (storageId: string, fileName: string) => void
}) {
  return (
    <Sheet
      open={Boolean(detailsWorkflow)}
      onOpenChange={(open) => {
        if (!open) onSetDetailsWorkflowId(null)
      }}
    >
      <SheetContent className="bg-panel border-line text-ink w-full max-w-full border-l p-0 sm:w-[540px]">
        <SheetHeader className="border-line-soft bg-panel-subtle border-b p-6 pb-4">
          <SheetTitle className="text-ink">Workflow Details</SheetTitle>
        </SheetHeader>
        {detailsWorkflow ? (
          <WorkflowDetails
            workflow={detailsWorkflow}
            artifacts={workflowArtifacts[String(detailsWorkflow._id)] ?? []}
            artifactsLoading={artifactsLoading}
            onDownloadArtifact={(storageId, fileName) =>
              void onDownloadArtifact(storageId, fileName)
            }
            onToggleActive={() => onToggleActive(detailsWorkflow)}
            onEditSchedule={() => onEditSchedule(detailsWorkflow)}
            onReset={() => onReset(detailsWorkflow)}
            onStopRun={() => onStopRun(detailsWorkflow)}
          />
        ) : (
          <div className="text-muted-foreground p-8 text-center">
            Workflow unavailable.
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ── Delete Confirmation Dialog ── */

import type { Id } from '../../../../../convex/_generated/dataModel'

function WorkflowDeleteDialog({
  deleteWorkflowId,
  saving,
  onSetDeleteWorkflowId,
  onConfirmDelete,
}: {
  deleteWorkflowId: Id<'workflows'> | null
  saving: boolean
  onSetDeleteWorkflowId: (id: Id<'workflows'> | null) => void
  onConfirmDelete: () => void
}) {
  return (
    <AlertDialog
      open={Boolean(deleteWorkflowId)}
      onOpenChange={(open) => {
        if (!open) onSetDeleteWorkflowId(null)
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
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={onConfirmDelete}
            disabled={saving}
          >
            {saving ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
