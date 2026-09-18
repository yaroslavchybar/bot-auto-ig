import { Plus, Upload } from 'lucide-react'
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
import { AutomationsList } from './components/AutomationsList'
import { AutomationDialog } from './components/AutomationDialog'
import { AutomationDetails } from './components/AutomationDetails'
import { useAutomationsPage } from './hooks/useAutomationsPage'

export function AutomationsPage() {
  const s = useAutomationsPage()
  return (
    <div className="bg-shell text-ink relative flex h-full flex-col overflow-hidden">
      <AutomationsHeader saving={s.saving}
        importInputRef={s.importInputRef}
        onCreate={s.handleCreate}
        onImportClick={s.handleImportClick} onImportFile={s.handleImportFile} />
      <AutomationsContent s={s} />
      <AutomationCrudDialogs isCreateOpen={s.isCreateOpen} editAutomation={s.editAutomation}
        saving={s.saving} onSetIsCreateOpen={s.setIsCreateOpen}
        onSetEditAutomationId={s.setEditAutomationId} onSaveCreate={s.handleSaveCreate}
        onSaveEdit={s.handleSaveEdit} />
      <AutomationDetailsSheet detailsAutomation={s.detailsAutomation}
        onSetDetailsAutomationId={s.setDetailsAutomationId} onToggleActive={s.handleToggleActive}
        onRun={s.handleRun} onReset={s.handleReset}
        onStopRun={s.handleStopRun} />
      <AutomationDeleteDialog deleteAutomationId={s.deleteAutomationId} saving={s.saving}
        onSetDeleteAutomationId={s.setDeleteAutomationId} onConfirmDelete={s.handleConfirmDelete} />
    </div>
  )
}

function AutomationsContent({ s }: { s: ReturnType<typeof useAutomationsPage> }) {
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <AutomationsList automations={s.automationsList} loading={s.automationsLoading}
          onToggleActive={s.handleToggleActive} onRun={s.handleRun} onStopRun={s.handleStopRun}
          onEdit={s.handleEdit} onEditFlow={s.handleEditFlow}
          onDuplicate={s.handleDuplicate}
          onExport={s.handleExport} onDelete={s.handleDelete}
          onViewDetails={s.handleViewDetails} />
      </div>
    </div>
  )
}

/* ── Header sub-component ── */

import type { ChangeEvent, RefObject } from 'react'

function AutomationsHeader({
  saving,
  importInputRef,
  onCreate,
  onImportClick,
  onImportFile,
}: {
  saving: boolean
  importInputRef: RefObject<HTMLInputElement | null>
  onCreate: () => void
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
            New Automation
          </Button>
          <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-3">
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

import type { Automation } from './types'

function AutomationCrudDialogs({
  isCreateOpen,
  editAutomation,
  saving,
  onSetIsCreateOpen,
  onSetEditAutomationId,
  onSaveCreate,
  onSaveEdit,
}: {
  isCreateOpen: boolean
  editAutomation: Automation | null
  saving: boolean
  onSetIsCreateOpen: (open: boolean) => void
  onSetEditAutomationId: (id: import('../../../../convex/_generated/dataModel').Id<'automations'> | null) => void
  onSaveCreate: (data: { name: string }) => void
  onSaveEdit: (data: { name: string }) => void
}) {
  return (
    <>
      <AutomationDialog
        open={isCreateOpen}
        onOpenChange={onSetIsCreateOpen}
        mode="create"
        saving={saving}
        onSave={onSaveCreate}
        onCancel={() => onSetIsCreateOpen(false)}
      />

      <AutomationDialog
        open={Boolean(editAutomation)}
        onOpenChange={(open) => {
          if (!open) onSetEditAutomationId(null)
        }}
        mode="edit"
        automation={editAutomation}
        saving={saving}
        onSave={onSaveEdit}
        onCancel={() => onSetEditAutomationId(null)}
      />
    </>
  )
}

/* ── Details Sheet ── */

function AutomationDetailsSheet({
  detailsAutomation,
  onSetDetailsAutomationId,
  onToggleActive,
  onRun,
  onReset,
  onStopRun,
}: {
  detailsAutomation: Automation | null
  onSetDetailsAutomationId: (id: import('../../../../convex/_generated/dataModel').Id<'automations'> | null) => void
  onToggleActive: (automation: Automation) => void
  onRun: (automation: Automation) => void
  onReset: (automation: Automation) => void
  onStopRun: (automation: Automation) => void
}) {
  return (
    <Sheet
      open={Boolean(detailsAutomation)}
      onOpenChange={(open) => {
        if (!open) onSetDetailsAutomationId(null)
      }}
    >
      <SheetContent className="bg-panel border-line text-ink w-full max-w-full border-l p-0 sm:w-[540px]">
        <SheetHeader className="border-line-soft bg-panel-subtle border-b p-6 pb-4">
          <SheetTitle className="text-ink">Automation Details</SheetTitle>
        </SheetHeader>
        {detailsAutomation ? (
          <AutomationDetails
            automation={detailsAutomation}
            onToggleActive={() => onToggleActive(detailsAutomation)}
            onRun={() => onRun(detailsAutomation)}
            onReset={() => onReset(detailsAutomation)}
            onStopRun={() => onStopRun(detailsAutomation)}
          />
        ) : (
          <div className="text-muted-foreground p-8 text-center">
            Automation unavailable.
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ── Delete Confirmation Dialog ── */

import type { Id } from './../../../../convex/_generated/dataModel'

function AutomationDeleteDialog({
  deleteAutomationId,
  saving,
  onSetDeleteAutomationId,
  onConfirmDelete,
}: {
  deleteAutomationId: Id<'automations'> | null
  saving: boolean
  onSetDeleteAutomationId: (id: Id<'automations'> | null) => void
  onConfirmDelete: () => void
}) {
  return (
    <AlertDialog
      open={Boolean(deleteAutomationId)}
      onOpenChange={(open) => {
        if (!open) onSetDeleteAutomationId(null)
      }}
    >
      <AlertDialogContent className="bg-panel border-line border shadow-xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-ink">
            Delete Automation
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-copy">
            Are you sure you want to delete this automation? This action cannot
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
