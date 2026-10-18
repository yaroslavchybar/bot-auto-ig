import { useCallback, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useCursorPage, useDebouncedSearch, usePageSize } from '@/hooks/use-cursor-page'
import type { ProxyFormValues, ProxyItem } from '../types'
import { normalizeProxy } from '../../../../../server/shared/proxy'
import { useErrorHandler } from '@/hooks/useErrorHandler'
import { useProxyPage } from './useProxyPage'

export function useProxiesPage(visible = true) {
  const { handleError } = useErrorHandler()

  const [searchQuery, setSearchQuery] = useState('')
  const search = useDebouncedSearch(searchQuery)
  const [pageSize, setPageSize] = usePageSize('proxies')
  const pagination = useCursorPage(JSON.stringify([search, pageSize]))
  const data = useProxyPage(
    visible
      ? {
          search,
          cursor: pagination.cursor,
          pageSize,
        }
      : 'skip',
  )
  const loading = visible && data === undefined
  const proxies = useMemo<ProxyItem[]>(
    () => data?.page.map((row) => ({ ...row, id: String(row._id) })) ?? [],
    [data],
  )
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  // Dialogs own their selection independently of reactive table pages.
  const [editProxy, setEditProxy] = useState<ProxyItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProxyItem | null>(null)
  const [saving, setSaving] = useState(false)

  const createProxy = useMutation(api.proxies.create)
  const updateProxy = useMutation(api.proxies.update)
  const deleteProxy = useMutation(api.proxies.remove)

  const handleCreate = useCallback(() => setIsCreateOpen(true), [])
  const handleEdit = useCallback((proxy: ProxyItem) => setEditProxy(proxy), [])
  const handleDeleteClick = useCallback((proxy: ProxyItem) => setDeleteTarget(proxy), [])
  const handleCloseCreate = useCallback(() => setIsCreateOpen(false), [])
  const handleCloseEdit = useCallback(() => setEditProxy(null), [])
  const handleCloseDelete = useCallback(() => setDeleteTarget(null), [])

  const handleSave = useCallback(
    async (values: ProxyFormValues) => {
      const name = values.name.trim()
      const rawProxy = values.proxy.trim()
      if (!name || !rawProxy) return
      const maxProfiles =
        Number.isFinite(values.maxProfiles) && values.maxProfiles >= 1
          ? Math.floor(values.maxProfiles)
          : 3
      setSaving(true)
      try {
        const { proxy, proxyType } = normalizeProxy(rawProxy, values.proxyType)
        if (isCreateOpen) {
          await createProxy({
            name,
            proxy,
            proxyType,
            purpose: values.purpose,
            country: values.country,
            maxProfiles,
          })
          setIsCreateOpen(false)
        } else if (editProxy) {
          await updateProxy({
            id: editProxy.id as Id<'proxies'>,
            name,
            proxy,
            proxyType,
            purpose: values.purpose,
            country: values.country,
            maxProfiles,
          })
          setEditProxy(null)
        }
      } catch (e) {
        handleError(e, 'Save proxy')
      } finally {
        setSaving(false)
      }
    },
    [createProxy, editProxy, handleError, isCreateOpen, updateProxy],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await deleteProxy({ id: deleteTarget.id as Id<'proxies'> })
      setDeleteTarget(null)
    } catch (e) {
      handleError(e, 'Delete proxy')
    } finally {
      setSaving(false)
    }
  }, [deleteProxy, deleteTarget, handleError])

  const usage = useMemo(
    () => Object.fromEntries(data?.page.map((row) => [String(row._id), row.usage]) ?? []),
    [data],
  )

  return {
    pagination: {
      ...pagination,
      hasNext: data !== undefined && !data.isDone,
      loading,
      next: () => {
        if (data && !data.isDone) pagination.next(data.continueCursor)
      },
    },
    proxies,
    allProxies: proxies,
    usage,
    pageSize,
    setPageSize,
    loading,
    saving,
    searchQuery,
    setSearchQuery,
    isCreateOpen,
    setIsCreateOpen,
    editProxy,
    deleteTarget,
    handleCreate,
    handleEdit,
    handleDeleteClick,
    handleCloseCreate,
    handleCloseEdit,
    handleSave,
    handleDelete,
    handleCloseDelete,
  }
}
