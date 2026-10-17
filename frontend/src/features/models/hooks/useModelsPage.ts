import { useCallback, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useModels } from './useModels'
import type { Model } from '../types'
import { useErrorHandler } from '@/hooks/useErrorHandler'

export function useModelsPage() {
  const { models, loading } = useModels()
  const { handleError } = useErrorHandler()
  const createModel = useMutation(api.models.create)
  const deleteModel = useMutation(api.models.remove)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [deleteModelTargetId, setDeleteModelTargetId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const deleteModelTarget = useMemo(
    () => models.find((model) => model.id === deleteModelTargetId) ?? null,
    [deleteModelTargetId, models],
  )

  const handleSave = useCallback(
    async (values: { name: string; baseFullName: string; usernames: string[] }) => {
      setSaving(true)
      try {
        await createModel(values)
        setIsCreateOpen(false)
      } catch (error) {
        handleError(error, 'Create model')
      } finally {
        setSaving(false)
      }
    },
    [createModel, handleError],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteModelTargetId) return
    setSaving(true)
    try {
      await deleteModel({ id: deleteModelTargetId as Id<'models'> })
      setDeleteModelTargetId(null)
    } catch (error) {
      handleError(error, 'Delete model')
    } finally {
      setSaving(false)
    }
  }, [deleteModelTargetId, deleteModel, handleError])

  return {
    models,
    loading,
    saving,
    isCreateOpen,
    setIsCreateOpen,
    deleteModelTarget,
    setDeleteModelTargetId,
    handleCreate: () => setIsCreateOpen(true),
    handleDeleteClick: (model: Model) => setDeleteModelTargetId(model.id),
    handleCloseCreate: () => setIsCreateOpen(false),
    handleSave,
    handleDelete,
  }
}
