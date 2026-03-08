import { useEffect, useMemo, useState } from 'react'
import { DeleteConfirmation } from './DeleteConfirmation'
import { ListsForm } from './ListsForm'
import { ListsList } from './ListsList'
import type { List } from './types'
import { createList, updateList, deleteList, bulkAddToList, bulkRemoveFromList } from './api'
import { useLists } from '@/hooks/useLists'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AmbientGlow } from '@/components/ui/ambient-glow'

export function ListsPage() {
  const { lists, loading: listsLoading, error: listsError, refresh, backgroundRefresh } = useLists()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loading = listsLoading
  const [saving, setSaving] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => lists.find((l) => l.id === selectedId) ?? null, [lists, selectedId])
  const surfacedError = error ?? listsError

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
    <div className="flex flex-col h-full bg-[#050505] text-gray-200 animate-in fade-in duration-300 relative">
      <AmbientGlow />

      {/* Header */}
      <div className="mobile-effect-blur mobile-effect-sticky flex items-center justify-between px-6 py-4 border-b bg-white/[0.02] border-white/5 backdrop-blur-xs sticky top-0 z-10">
        <div>
          <h2 className="text-xl font-semibold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Lists Manager</h2>
          <p className="text-sm text-gray-400">Manage profile collections and mapping state.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || saving}
            className="h-8 shadow-none bg-transparent border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={handleCreate}
            disabled={loading || saving}
            className="mobile-effect-shadow h-8 border-none bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-orange-400 transition-all font-medium"
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            Create List
          </Button>
        </div>
      </div>

      {surfacedError && !showDeleteDialog && !isCreateOpen && !isEditOpen && (
        <div className="px-6 py-3 bg-red-500/10 text-red-400 text-sm border-b border-red-500/20 flex items-center shadow-[0_0_10px_rgba(239,68,68,0.2)] relative z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-2" />
          {surfacedError}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6 relative z-10">
        <div className="max-w-[2000px] mx-auto">
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
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col bg-[#0a0a0a] border-white/10 text-gray-200">
          <DialogHeader className="shrink-0">
            <DialogTitle className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Create List</DialogTitle>
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
          className="sm:max-w-[960px] max-h-[88vh] gap-0 overflow-hidden p-0 bg-[#0a0a0a] border-white/10 text-gray-200"
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
            <div className="p-4 text-sm text-gray-500">Select a list first</div>
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
