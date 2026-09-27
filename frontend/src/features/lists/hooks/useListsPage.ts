import { useCallback, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useLists } from './useLists'
import type { List } from '../types'
import { useErrorHandler } from '@/hooks/useErrorHandler'

export function useListsPage() {
  const { lists, loading } = useLists()
  const { handleError } = useErrorHandler()
  const createModel = useMutation(api.lists.create)
  const deleteModel = useMutation(api.lists.remove)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [deleteListTargetId, setDeleteListTargetId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const deleteListTarget = useMemo(
    () => lists.find((model) => model.id === deleteListTargetId) ?? null,
    [deleteListTargetId, lists],
  )

  const handleSave = useCallback(async (values: { name: string; fullName: string; usernames: string[] }) => {
    setSaving(true)
    try {
      await createModel(values)
      setIsCreateOpen(false)
    } catch (error) {
      handleError(error, 'Create model')
    } finally {
      setSaving(false)
    }
  }, [createModel, handleError])

  const handleDelete = useCallback(async () => {
    if (!deleteListTargetId) return
    setSaving(true)
    try {
      await deleteModel({ id: deleteListTargetId as Id<'lists'> })
      setDeleteListTargetId(null)
    } catch (error) {
      handleError(error, 'Delete model')
    } finally {
      setSaving(false)
    }
  }, [deleteListTargetId, deleteModel, handleError])

  return {
    lists, loading, saving,
    isCreateOpen, setIsCreateOpen,
    deleteListTarget, setDeleteListTargetId,
    handleCreate: () => setIsCreateOpen(true),
    handleDeleteClick: (model: List) => setDeleteListTargetId(model.id),
    handleCloseCreate: () => setIsCreateOpen(false),
    handleSave, handleDelete,
  }
}
