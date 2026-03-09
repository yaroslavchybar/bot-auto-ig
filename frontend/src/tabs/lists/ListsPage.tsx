import { useEffect, useState } from 'react'
import { DeleteConfirmation } from './DeleteConfirmation'
import { ListsForm } from './ListsForm'
import { ListsList } from './ListsList'
import type { List } from './types'
import {
  createList,
  updateList,
  deleteList,
  bulkAddToList,
  bulkRemoveFromList,
} from './api'
import { useLists } from '@/hooks/useLists'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AmbientGlow } from '@/components/ui/ambient-glow'

export function ListsPage() {
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
      <div className="mobile-effect-blur mobile-effect-sticky bg-panel-subtle border-line-soft sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4 backdrop-blur-xs">
        <div>
          <h2 className="page-title-gradient text-xl font-semibold tracking-tight">
            Lists Manager
          </h2>
          <p className="text-muted-copy text-sm">
            Manage profile collections and mapping state.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || saving}
            className="border-line text-copy hover:bg-panel-hover h-8 bg-transparent shadow-none transition-all hover:text-ink"
          >
            <RefreshCw
              className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
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

      {surfacedError && !deleteListTarget && !isCreateOpen && !editList && (
        <div className="status-banner-danger relative z-10 flex items-center border-b px-6 py-3 text-sm">
          <span className="status-dot-danger mr-2 h-1.5 w-1.5 rounded-full" />
          {surfacedError}
        </div>
      )}

      {/* Main Content */}
      <div className="relative z-10 flex-1 overflow-auto p-6">
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

      {deleteListTarget && (
        <DeleteConfirmation
          open={Boolean(deleteListTarget)}
          listName={deleteListTarget.name}
          saving={saving}
          error={error}
          onConfirm={handleDelete}
          onCancel={() => setDeleteListTarget(null)}
        />
      )}
    </div>
  )
}
