import { useEffect, useState } from 'react'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { ListsForm } from '../components/ListsForm'
import { ListsList } from '../components/ListsList'
import type { List } from '../types'
import {
  createList,
  updateList,
  deleteList,
  bulkAddToList,
  bulkRemoveFromList,
} from '../api'
import { useLists } from '@/features/lists/hooks/useLists'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AmbientGlow } from '@/components/ui/ambient-glow'

export function ListsPageContainer() {
  const {
    lists,
    loading: listsLoading,
    error: listsError,
    refresh,
    backgroundRefresh,
  } = useLists()
  const loading = listsLoading
  const [saving, setSaving] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editList, setEditList] = useState<List | null>(null)
  const [deleteListTarget, setDeleteListTarget] = useState<List | null>(null)
  const [error, setError] = useState<string | null>(null)
  const surfacedError = error ?? listsError

  useEffect(() => {
    if (editList && !lists.find((list) => list.id === editList.id)) {
      setEditList(null)
    }
    if (
      deleteListTarget &&
      !lists.find((list) => list.id === deleteListTarget.id)
    ) {
      setDeleteListTarget(null)
    }
  }, [deleteListTarget, editList, lists])

  const handleCreate = () => {
    setIsCreateOpen(true)
    setError(null)
  }

  const handleEdit = (list: List) => {
    setEditList(list)
    setError(null)
  }

  const handleDeleteClick = (list: List) => {
    setDeleteListTarget(list)
    setError(null)
  }

  const handleCloseCreate = () => {
    setIsCreateOpen(false)
    setError(null)
  }

  const handleCloseEdit = () => {
    setEditList(null)
    setError(null)
  }

  const handleCreateOpenChange = (open: boolean) => {
    setIsCreateOpen(open)
    if (!open) {
      setError(null)
    }
  }

  const handleEditOpenChange = (open: boolean) => {
    if (!open) {
      setEditList(null)
      setError(null)
    }
  }

  const handleSave = async (
    name: string,
    addedIds: string[],
    removedIds: string[],
  ) => {
    setSaving(true)
    setError(null)
    try {
      if (isCreateOpen) {
        await createList(name)
        await backgroundRefresh()
        setIsCreateOpen(false)
      } else if (editList) {
        if (editList.name !== name) {
          await updateList(editList.id, name)
        }
        if (addedIds.length > 0) {
          await bulkAddToList(addedIds, editList.id)
        }
        if (removedIds.length > 0) {
          await bulkRemoveFromList(removedIds, editList.id)
        }
        await backgroundRefresh()
        setEditList(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteListTarget) return
    setSaving(true)
    setError(null)
    try {
      await deleteList(deleteListTarget.id)
      await backgroundRefresh()
      setDeleteListTarget(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />

      {/* Header */}
      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
          <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void refresh()}
            disabled={loading || saving}
            aria-label="Refresh lists"
            title="Refresh lists"
            className="h-8 w-8 shrink-0 rounded-md border-transparent bg-[rgb(51,51,62)] p-0 text-[rgb(163,163,177)] shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.05),0_2px_2px_-1px_rgba(0,0,0,0.16),0_4px_4px_-2px_rgba(0,0,0,0.24),0_0_0_1px_rgba(0,0,0,0.1)] transition-[background-color,box-shadow,color] hover:bg-[rgb(58,58,70)] hover:text-[rgb(246,246,247)] focus-visible:ring-0"
          >
            <RefreshCw
              className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
            />
            <span className="sr-only">Refresh</span>
          </Button>

          <Button
            size="sm"
            onClick={handleCreate}
            disabled={loading || saving}
            className="mobile-effect-shadow brand-button h-8 font-medium"
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            Create List
          </Button>
        </div>
      </div>
      </div>

      {surfacedError && !deleteListTarget && !isCreateOpen && !editList && (
        <div className="status-banner-danger relative z-10 flex items-center border-b px-6 py-3 text-sm">
          <span className="status-dot-danger mr-2 h-1.5 w-1.5 rounded-full" />
          {surfacedError}
        </div>
      )}

      {/* Main Content */}
      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px]">
          <ListsList
            lists={lists}
            loading={loading}
            onEdit={handleEdit}
            onDelete={handleDeleteClick}
          />
        </div>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[800px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">
              Create List
            </DialogTitle>
          </DialogHeader>
          <ListsForm
            mode="create"
            saving={saving}
            error={error}
            onSave={(name) => handleSave(name, [], [])}
            onCancel={handleCloseCreate}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editList)} onOpenChange={handleEditOpenChange}>
        <DialogContent
          hideClose
          className="bg-panel border-line text-ink max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-[960px]"
        >
          {editList ? (
            <ListsForm
              key={editList.id}
              mode="edit"
              initialData={editList}
              saving={saving}
              error={error}
              onSave={handleSave}
              onCancel={handleCloseEdit}
            />
          ) : (
            <div className="text-subtle-copy p-4 text-sm">
              List unavailable.
            </div>
          )}
        </DialogContent>
      </Dialog>

      {deleteListTarget ? (
        <ConfirmDeleteDialog
          open={Boolean(deleteListTarget)}
          title="Delete List?"
          entityLabel=""
          itemName={deleteListTarget.name}
          confirmLabel="Delete List"
          saving={saving}
          error={error}
          onConfirm={handleDelete}
          onCancel={() => setDeleteListTarget(null)}
        />
      ) : null}
    </div>
  )
}




