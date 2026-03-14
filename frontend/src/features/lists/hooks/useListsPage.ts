import { useCallback, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useLists } from './useLists'
import type { List } from '../types'
import { useErrorHandler } from '@/hooks/useErrorHandler'

/* ── Dialog state ── */

function useListDialogState(lists: List[]) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editListId, setEditListId] = useState<string | null>(null)
  const [deleteListTargetId, setDeleteListTargetId] = useState<string | null>(null)

  const editList = useMemo(
    () => (editListId ? lists.find((l) => l.id === editListId) ?? null : null),
    [editListId, lists],
  )
  const deleteListTarget = useMemo(
    () => (deleteListTargetId ? lists.find((l) => l.id === deleteListTargetId) ?? null : null),
    [deleteListTargetId, lists],
  )

  const handleCreate = () => { setIsCreateOpen(true) }
  const handleEdit = (list: List) => { setEditListId(list.id) }
  const handleDeleteClick = (list: List) => { setDeleteListTargetId(list.id) }
  const handleCloseCreate = () => { setIsCreateOpen(false) }
  const handleCloseEdit = () => { setEditListId(null) }
  const handleCreateOpenChange = (open: boolean) => { setIsCreateOpen(open) }
  const handleEditOpenChange = (open: boolean) => { if (!open) { setEditListId(null) } }

  return {
    isCreateOpen, setIsCreateOpen, editList, setEditListId,
    deleteListTarget, setDeleteListTargetId,
    handleCreate, handleEdit, handleDeleteClick, handleCloseCreate, handleCloseEdit,
    handleCreateOpenChange, handleEditOpenChange,
  }
}

/* ── Mutations ── */

function useListMutations(
  dialog: ReturnType<typeof useListDialogState>,
  backgroundRefresh: () => Promise<void>,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const createList = useMutation(api.lists.create)
  const updateList = useMutation(api.lists.update)
  const deleteListMut = useMutation(api.lists.remove)
  const bulkAddToList = useMutation(api.profiles.mutations.bulkAddToList)
  const bulkRemoveFromList = useMutation(api.profiles.mutations.bulkRemoveFromList)
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async (name: string, addedIds: string[], removedIds: string[]) => {
    setSaving(true)
    try {
      if (dialog.isCreateOpen) {
        await createList({ name }); await backgroundRefresh(); dialog.setIsCreateOpen(false)
      } else if (dialog.editList) {
        if (dialog.editList.name !== name) await updateList({ id: dialog.editList.id as Id<'lists'>, name })
        if (addedIds.length > 0) await bulkAddToList({ profileIds: addedIds as Id<'profiles'>[], listId: dialog.editList.id as Id<'lists'> })
        if (removedIds.length > 0) await bulkRemoveFromList({ profileIds: removedIds as Id<'profiles'>[], listId: dialog.editList.id as Id<'lists'> })
        await backgroundRefresh(); dialog.setEditListId(null)
      }
    } catch (e) { handleError(e, 'Save list') }
    finally { setSaving(false) }
  }, [backgroundRefresh, bulkAddToList, bulkRemoveFromList, createList, dialog, handleError, updateList])

  const handleDelete = useCallback(async () => {
    if (!dialog.deleteListTarget) return
    setSaving(true)
    try {
      await deleteListMut({ id: dialog.deleteListTarget.id as Id<'lists'> })
      await backgroundRefresh(); dialog.setDeleteListTargetId(null)
    } catch (e) { handleError(e, 'Delete list') }
    finally { setSaving(false) }
  }, [backgroundRefresh, deleteListMut, dialog, handleError])

  return { saving, handleSave, handleDelete }
}

export function useListsPage() {
  const { lists, loading: listsLoading, refresh, backgroundRefresh } = useLists()
  const loading = listsLoading
  const [refreshing, setRefreshing] = useState(false)
  const { handleError } = useErrorHandler()

  const dialog = useListDialogState(lists)
  const mutations = useListMutations(dialog, backgroundRefresh, handleError)

  const handleRefreshLists = useCallback(async () => {
    setRefreshing(true)
    try { await Promise.all([refresh(), new Promise((r) => setTimeout(r, 300))]) }
    finally { setRefreshing(false) }
  }, [refresh])

  return {
    lists, loading, saving: mutations.saving, refreshing,
    isCreateOpen: dialog.isCreateOpen, editList: dialog.editList,
    deleteListTarget: dialog.deleteListTarget,
    handleCreate: dialog.handleCreate, handleEdit: dialog.handleEdit,
    handleDeleteClick: dialog.handleDeleteClick,
    handleCloseCreate: dialog.handleCloseCreate, handleCloseEdit: dialog.handleCloseEdit,
    handleCreateOpenChange: dialog.handleCreateOpenChange,
    handleEditOpenChange: dialog.handleEditOpenChange,
    handleSave: mutations.handleSave, handleDelete: mutations.handleDelete,
    handleRefreshLists, setDeleteListTargetId: dialog.setDeleteListTargetId,
  }
}
