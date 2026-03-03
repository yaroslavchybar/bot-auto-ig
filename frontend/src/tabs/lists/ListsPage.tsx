import { useEffect, useMemo, useState } from 'react'
import { DeleteConfirmation } from './DeleteConfirmation'
import { ListsForm } from './ListsForm'
import { ListsList } from './ListsList'
import type { List } from './types'
import { createList, updateList, deleteList, bulkAddToList, bulkRemoveFromList } from './api'
import { useLists } from '@/hooks/useLists'
import { Dialog, DialogContent, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { Plus, RefreshCw, X, List as ListIcon, Hash, Pencil, Trash2, AlertCircle } from 'lucide-react'
import { DenseButton } from '@/components/ui/dense-button'

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
  const selectedPosition = useMemo(() => {
    if (!selected) return null
    const idx = lists.findIndex((l) => l.id === selected.id)
    return idx >= 0 ? idx + 1 : null
  }, [lists, selected])
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

  const handleEditSelected = () => {
    if (!selected) return
    handleEdit(selected)
  }

  const handleDeleteSelected = () => {
    if (!selected) return
    handleDeleteClick(selected)
  }

  return (
    <div className="flex flex-col h-full bg-neutral-200 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 font-sans text-xs overflow-hidden select-none">
      {/* Top Application Ribbon */}
      <div className="flex flex-col bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 shrink-0 shadow-sm z-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-700/50 gap-2 sm:gap-0">
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
                Lists Manager
              </h2>
              <span className="text-[10px] text-neutral-500 font-mono">[SYSTEM LISTS]</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <DenseButton onClick={() => void refresh()} disabled={loading || saving}>
              <RefreshCw className={`mr-1.5 h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </DenseButton>

            <div className="w-px h-3.5 bg-neutral-300 dark:bg-neutral-600 mx-1" />

            <DenseButton
              onClick={handleCreate}
              disabled={loading || saving}
              className="font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
            >
              <Plus className="mr-1.5 h-3 w-3" />
              Create List
            </DenseButton>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between px-2 py-1 bg-white/50 dark:bg-neutral-900/20 gap-2 md:gap-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="h-6 px-2 rounded-[3px] border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-300 inline-flex items-center gap-1.5">
              <ListIcon className="h-3 w-3 text-neutral-500" />
              {lists.length} Lists
            </div>

            <div className="h-6 px-2 rounded-[3px] border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-300 inline-flex items-center gap-1.5">
              <Hash className="h-3 w-3 text-neutral-500" />
              {selectedPosition ? `Selected ${selectedPosition}/${lists.length}` : 'No Selection'}
            </div>

            {selected && (
              <div className="h-6 px-2 rounded-[3px] border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-[10px] text-neutral-500 dark:text-neutral-400 inline-flex items-center font-mono max-w-[340px] truncate">
                {selected.id}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <DenseButton onClick={handleEditSelected} disabled={!selected || loading || saving}>
              <Pencil className="mr-1.5 h-3 w-3" />
              Edit Selected
            </DenseButton>
            <DenseButton
              onClick={handleDeleteSelected}
              disabled={!selected || loading || saving}
              className="text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
            >
              <Trash2 className="mr-1.5 h-3 w-3" />
              Delete Selected
            </DenseButton>
          </div>
        </div>
      </div>

      {surfacedError && !showDeleteDialog && !isCreateOpen && !isEditOpen && (
        <div className="px-3 py-1.5 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-b border-red-200 dark:border-red-900/50 text-[11px] font-medium shrink-0 flex items-center">
          <AlertCircle className="h-3.5 w-3.5 mr-1.5 shrink-0" />
          {surfacedError}
        </div>
      )}

      {/* Main Data View */}
      <div className="flex min-h-0 flex-1 overflow-hidden flex-col bg-white dark:bg-[#121212] m-1 rounded-[3px] border border-neutral-300 dark:border-neutral-700 shadow-sm relative">
        <div className="flex items-center justify-between px-2 py-1 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 text-[10px] text-neutral-500 dark:text-neutral-400">
          <div className="flex min-w-0 items-center gap-2">
            <span className="uppercase tracking-wider font-semibold">Active List</span>
            {selected ? (
              <>
                <span className="text-[11px] text-neutral-700 dark:text-neutral-200 font-medium truncate">{selected.name}</span>
                <span className="hidden sm:inline font-mono truncate max-w-[280px]">{selected.id}</span>
              </>
            ) : (
              <span className="text-[11px] italic">None selected</span>
            )}
          </div>
          <div className="font-mono uppercase tracking-wide">
            {loading ? 'Synchronizing' : 'Ready'}
          </div>
        </div>

        <ListsList
          lists={lists}
          selectedId={selectedId}
          loading={loading}
          onSelect={handleSelect}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
        />
      </div>

      {/* Bottom Status Bar */}
      <div className="h-auto min-h-[20px] shrink-0 bg-neutral-200 dark:bg-neutral-800 border-t border-neutral-300 dark:border-neutral-700 px-2 py-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
        <div className="flex flex-wrap items-center gap-3">
          <span>{lists.length} Lists Available</span>
          {selected && <span>{selected.name}</span>}
        </div>
        <div className="flex items-center">
          <span className="hidden sm:inline">{saving ? 'Saving changes...' : loading ? 'Refreshing data...' : 'Ready'}</span>
        </div>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent hideClose className="p-0 border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 rounded-[3px] gap-0 border shadow-md w-[800px] max-w-[90vw] max-h-[85vh] overflow-hidden flex flex-col items-center justify-center">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-200/50 dark:bg-neutral-900/50 w-full shrink-0">
            <DialogTitle className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 m-0 leading-none">Create List</DialogTitle>
            <DialogClose className="rounded-[2px] opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:pointer-events-none text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
              <X className="h-3.5 w-3.5" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
          <div className="flex-1 w-full min-h-0 overflow-hidden bg-white dark:bg-[#121212]">
            <ListsForm
              mode="create"
              saving={saving}
              error={error}
              onSave={(name) => handleSave(name, [], [])}
              onCancel={handleCloseDialogs}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent hideClose className="p-0 border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 rounded-[3px] gap-0 border shadow-md w-[800px] max-w-[90vw] max-h-[85vh] overflow-hidden flex flex-col items-center justify-center">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-200/50 dark:bg-neutral-900/50 w-full shrink-0">
            <DialogTitle className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 m-0 leading-none">Edit List</DialogTitle>
            <DialogClose className="rounded-[2px] opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:pointer-events-none text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
              <X className="h-3.5 w-3.5" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
          <div className="flex-1 w-full min-h-0 overflow-hidden bg-white dark:bg-[#121212]">
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
              <div className="p-4 text-xs text-neutral-500">Select a list first</div>
            )}
          </div>
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
