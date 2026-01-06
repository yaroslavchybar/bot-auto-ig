import { useEffect, useMemo, useState } from 'react'
import { DeleteConfirmation } from './DeleteConfirmation'
import { ListsForm } from './ListsForm'
import { ListsList } from './ListsList'
import type { List } from './types'
import { createList, updateList, deleteList, bulkSetListId } from './api'
import { useLists } from '@/hooks/useLists'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, RefreshCw } from 'lucide-react'

export function ListsPage() {
  const { lists, loading: listsLoading, refresh, backgroundRefresh } = useLists()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loading = listsLoading
  const [saving, setSaving] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => lists.find((l) => l.id === selectedId) ?? null, [lists, selectedId])

  // Ensure we have a selection if possible
  useEffect(() => {
    if (!selectedId && lists.length > 0) {
      setSelectedId(lists[0].id)
    } else if (selectedId && !lists.find(l => l.id === selectedId) && lists.length > 0) {
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

  const handleSave = async (name: string, addedIds: string[], removedIds: string[]) => {
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
          await bulkSetListId(addedIds, selected.id)
        }
        if (removedIds.length > 0) {
          await bulkSetListId(removedIds, null)
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
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-2xl font-bold tracking-tight">Lists Manager</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refresh()} disabled={loading || saving}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={loading || saving}>
            <Plus className="mr-2 h-4 w-4" />
            Create
          </Button>
        </div>
      </div>

      {error && !showDeleteDialog && !isCreateOpen && !isEditOpen && (
        <div className="p-4 bg-destructive/10 text-destructive text-sm border-b border-destructive/20">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 bg-muted/10">
        <ListsList
          lists={lists}
          selectedId={selectedId}
          loading={loading}
          onSelect={handleSelect}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
        />
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create List</DialogTitle>
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

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit List</DialogTitle>
          </DialogHeader>
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
            <div className="text-sm text-muted-foreground">Select a list first</div>
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
