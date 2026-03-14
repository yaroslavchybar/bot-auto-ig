import { useCallback, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useLists } from './useLists'
import type { List } from '../types'

/* ── Dialog state ── */

function useListDialogState(lists: List[]) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editListId, setEditListId] = useState<string | null>(null)
  const [deleteListTargetId, setDeleteListTargetId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const editList = useMemo(
    () => (editListId ? lists.find((l) => l.id === editListId) ?? null : null),
    [editListId, lists],
  )
  const deleteListTarget = useMemo(
    () => (deleteListTargetId ? lists.find((l) => l.id === deleteListTargetId) ?? null : null),
    [deleteListTargetId, lists],
  )

  const handleCreate = () => { setIsCreateOpen(true); setError(null) }
  const handleEdit = (list: List) => { setEditListId(list.id); setError(null) }
  const handleDeleteClick = (list: List) => { setDeleteListTargetId(list.id); setError(null) }
  const handleCloseCreate = () => { setIsCreateOpen(false); setError(null) }
  const handleCloseEdit = () => { setEditListId(null); setError(null) }
  const handleCreateOpenChange = (open: boolean) => { setIsCreateOpen(open); if (!open) setError(null) }
  const handleEditOpenChange = (open: boolean) => { if (!open) { setEditListId(null); setError(null) } }

  return {
    isCreateOpen, setIsCreateOpen, editList, setEditListId,
    deleteListTarget, setDeleteListTargetId, error, setError,
    handleCreate, handleEdit, handleDeleteClick, handleCloseCreate, handleCloseEdit,
    handleCreateOpenChange, handleEditOpenChange,
  }
}

/* ── Mutations ── */

function useListMutations(
  dialog: ReturnType<typeof useListDialogState>,
  backgroundRefresh: () => Promise<void>,
) {
  const createList = useMutation(api.lists.create)
  const updateList = useMutation(api.lists.update)
  const deleteListMut = useMutation(api.lists.remove)
  const bulkAddToList = useMutation(api.profiles.mutations.bulkAddToList)
  const bulkRemoveFromList = useMutation(api.profiles.mutations.bulkRemoveFromList)
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async (name: string, addedIds: string[], removedIds: string[]) => {
    setSaving(true); dialog.setError(null)
    try {
      if (dialog.isCreateOpen) {
        await createList({ name }); await backgroundRefresh(); dialog.setIsCreateOpen(false)
      } else if (dialog.editList) {
        if (dialog.editList.name !== name) await updateList({ id: dialog.editList.id as Id<'lists'>, name })
        if (addedIds.length > 0) await bulkAddToList({ profileIds: addedIds as Id<'profiles'>[], listId: dialog.editList.id as Id<'lists'> })
        if (removedIds.length > 0) await bulkRemoveFromList({ profileIds: removedIds as Id<'profiles'>[], listId: dialog.editList.id as Id<'lists'> })
        await backgroundRefresh(); dialog.setEditListId(null)
      }
    } catch (e) { dialog.setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }, [backgroundRefresh, bulkAddToList, bulkRemoveFromList, createList, dialog, updateList])

  const handleDelete = useCallback(async () => {
    if (!dialog.deleteListTarget) return
    setSaving(true); dialog.setError(null)
    try {
      await deleteListMut({ id: dialog.deleteListTarget.id as Id<'lists'> })
      await backgroundRefresh(); dialog.setDeleteListTargetId(null)
    } catch (e) { dialog.setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }, [backgroundRefresh, deleteListMut, dialog])

  return { saving, handleSave, handleDelete }
}

export function useListsPage() {
  const { lists, loading: listsLoading, error: listsError, refresh, backgroundRefresh } = useLists()
  const loading = listsLoading
  const [refreshing, setRefreshing] = useState(false)

  const dialog = useListDialogState(lists)
  const mutations = useListMutations(dialog, backgroundRefresh)
  const surfacedError = dialog.error ?? listsError

  const handleRefreshLists = useCallback(async () => {
    setRefreshing(true)
    try { await Promise.all([refresh(), new Promise((r) => setTimeout(r, 300))]) }
    finally { setRefreshing(false) }
  }, [refresh])

  return {
    lists, loading, saving: mutations.saving, refreshing,
    isCreateOpen: dialog.isCreateOpen, editList: dialog.editList,
    deleteListTarget: dialog.deleteListTarget,
    error: dialog.error, surfacedError,
    handleCreate: dialog.handleCreate, handleEdit: dialog.handleEdit,
    handleDeleteClick: dialog.handleDeleteClick,
    handleCloseCreate: dialog.handleCloseCreate, handleCloseEdit: dialog.handleCloseEdit,
    handleCreateOpenChange: dialog.handleCreateOpenChange,
    handleEditOpenChange: dialog.handleEditOpenChange,
    handleSave: mutations.handleSave, handleDelete: mutations.handleDelete,
    handleRefreshLists, setDeleteListTargetId: dialog.setDeleteListTargetId,
  }
}
