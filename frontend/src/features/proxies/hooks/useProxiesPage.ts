import { useCallback, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useCursorPage, useDebouncedSearch } from '@/hooks/use-cursor-page'
import type { ProxyFormValues, ProxyItem } from '../types'
import { normalizeProxy } from '../../../../../server/shared/proxy'
import { DEFAULT_PAGE_SIZE, type PageSize } from '../../../../../server/shared/pagination'
import { useErrorHandler } from '@/hooks/useErrorHandler'
import { useProxyPage } from './useProxyPage'

export function useProxiesPage(visible = true) {
  const { handleError } = useErrorHandler()

  const [searchQuery, setSearchQuery] = useState('')
  const search = useDebouncedSearch(searchQuery)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const pagination = useCursorPage(JSON.stringify([search, pageSize]))
  const data = useProxyPage(visible ? {
    search,
    cursor: pagination.cursor,
    pageSize,
  } : 'skip')
  const loading = visible && data === undefined
  const proxies = useMemo<ProxyItem[]>(
    () => data?.page.map((row) => ({ ...row, id: String(row._id) })) ?? [],
    [data],
  )
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editProxyId, setEditProxyId] = useState<string | null>(null)
  const [deleteProxyId, setDeleteProxyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const createProxy = useMutation(api.proxies.create)
  const updateProxy = useMutation(api.proxies.update)
  const deleteProxy = useMutation(api.proxies.remove)

  const editProxy = useMemo(
    () => (editProxyId ? (proxies.find((p) => p.id === editProxyId) ?? null) : null),
    [editProxyId, proxies],
  )
  const deleteTarget = useMemo(
    () => (deleteProxyId ? (proxies.find((p) => p.id === deleteProxyId) ?? null) : null),
    [deleteProxyId, proxies],
  )

  const handleCreate = useCallback(() => setIsCreateOpen(true), [])
  const handleEdit = useCallback((proxy: ProxyItem) => setEditProxyId(proxy.id), [])
  const handleDeleteClick = useCallback((proxy: ProxyItem) => setDeleteProxyId(proxy.id), [])
  const handleCloseCreate = useCallback(() => setIsCreateOpen(false), [])
  const handleCloseEdit = useCallback(() => setEditProxyId(null), [])

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
          setEditProxyId(null)
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
      setDeleteProxyId(null)
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
    setDeleteProxyId,
  }
}
