import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { ListsForm } from '../components/ListsForm'
import { ListsList } from '../components/ListsList'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useListsPage } from '../hooks/useListsPage'

export function ListsPageContainer() {
  const state = useListsPage()

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />
      <ListsHeader loading={state.loading} saving={state.saving}
        refreshing={state.refreshing} onCreate={state.handleCreate}
        onRefresh={() => void state.handleRefreshLists()} />

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px]">
          <ListsList lists={state.lists} loading={state.loading}
            onEdit={state.handleEdit} onDelete={state.handleDeleteClick} />
        </div>
      </div>

      <ListsDialogs state={state} />
    </div>
  )
}

function ListsHeader({ loading, saving, refreshing, onCreate, onRefresh }: {
  loading: boolean; saving: boolean; refreshing: boolean
  onCreate: () => void; onRefresh: () => void
}) {
  return (
    <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={onRefresh}
            disabled={loading || saving || refreshing} aria-label="Refresh lists"
            className="h-8 w-8 shrink-0 p-0">
            <RefreshCw className={loading || refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            <span className="sr-only">Refresh</span>
          </Button>
          <Button size="sm" onClick={onCreate} disabled={loading || saving}
            className="mobile-effect-shadow brand-button h-8 font-medium">
            <Plus className="mr-2 h-3.5 w-3.5" /> Create List
          </Button>
        </div>
      </div>
    </div>
  )
}

function ListsDialogs({ state }: { state: ReturnType<typeof useListsPage> }) {
  return (
    <>
      <Dialog open={state.isCreateOpen} onOpenChange={state.handleCreateOpenChange}>
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[800px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Create List</DialogTitle>
          </DialogHeader>
          <ListsForm key={state.isCreateOpen ? 'create-open' : 'create-closed'}
            mode="create" saving={state.saving}
            onSave={(name) => state.handleSave(name, [], [])}
            onCancel={state.handleCloseCreate} />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(state.editList)} onOpenChange={state.handleEditOpenChange}>
        <DialogContent hideClose
          className="bg-panel border-line text-ink max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-[960px]">
          {state.editList ? (
            <ListsForm key={state.editList.id} mode="edit" initialData={state.editList}
              saving={state.saving}
              onSave={state.handleSave} onCancel={state.handleCloseEdit} />
          ) : (
            <div className="text-subtle-copy p-4 text-sm">List unavailable.</div>
          )}
        </DialogContent>
      </Dialog>

      {state.deleteListTarget ? (
        <ConfirmDeleteDialog open={Boolean(state.deleteListTarget)}
          title="Delete List?" entityLabel="" itemName={state.deleteListTarget.name}
          confirmLabel="Delete List" saving={state.saving} error={null}
          onConfirm={state.handleDelete} onCancel={() => state.setDeleteListTargetId(null)} />
      ) : null}
    </>
  )
}
