import { useEffect, useMemo, useState } from 'react'
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
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loading = listsLoading
  const [saving, setSaving] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(
    () => lists.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId],
  )
  const surfacedError = error ?? listsError

  // Ensure we have a selection if possible
  useEffect(() => {
    if (!selectedId && lists.length > 0) {
      setSelectedId(lists[0].id)
    } else if (
      selectedId &&
      !lists.find((l) => l.id === selectedId) &&
      lists.length > 0
    ) {
      setSelectedId(lists[0].id)
    }
  }, [lists, selectedId])

  const handleCreate = () => {
    setIsCreateOpen(true)
    setError(null)
  }

  const handleEdit = (list: List) => {
    setSelectedId(list.id)
    setIsEditOpen(true)
    setError(null)
  }

  const handleDeleteClick = (list: List) => {
    setSelectedId(list.id)
    setShowDeleteDialog(true)
    setError(null)
  }

  const handleSelect = (list: List) => {
    setSelectedId(list.id)
    setError(null)
  }

  const handleCloseDialogs = () => {
    setIsCreateOpen(false)
    setIsEditOpen(false)
    setShowDeleteDialog(false)
    setError(null)
  }

  const handleCreateOpenChange = (open: boolean) => {
    setIsCreateOpen(open)
    if (!open) {
      setError(null)
    }
  }

  const handleEditOpenChange = (open: boolean) => {
    setIsEditOpen(open)
    if (!open) {
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
      } else if (isEditOpen && selected) {
        if (selected.name !== name) {
          await updateList(selected.id, name)
        }
        if (addedIds.length > 0) {
          await bulkAddToList(addedIds, selected.id)
        }
        if (removedIds.length > 0) {
          await bulkRemoveFromList(removedIds, selected.id)
        }
        await backgroundRefresh()
        setIsEditOpen(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      await deleteList(selected.id)
      await backgroundRefresh()
      setShowDeleteDialog(false)
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
            className="border-line text-copy hover:bg-panel-hover h-8 bg-transparent shadow-none transition-all hover:text-white"
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

      {surfacedError && !showDeleteDialog && !isCreateOpen && !isEditOpen && (
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
            selectedId={selectedId}
            loading={loading}
            onSelect={handleSelect}
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
            onCancel={handleCloseDialogs}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={handleEditOpenChange}>
        <DialogContent
          hideClose
          className="bg-panel border-line text-ink max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-[960px]"
        >
          {selected ? (
            <ListsForm
              key={selected.id}
              mode="edit"
              initialData={selected}
              saving={saving}
              error={error}
              onSave={handleSave}
              onCancel={handleCloseDialogs}
            />
          ) : (
            <div className="text-subtle-copy p-4 text-sm">
              Select a list first
            </div>
          )}
        </DialogContent>
      </Dialog>

      {selected && (
        <DeleteConfirmation
          open={showDeleteDialog}
          listName={selected.name}
          saving={saving}
          error={error}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </div>
  )
}
