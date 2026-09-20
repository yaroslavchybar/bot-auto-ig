import { useCallback, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useProxies } from './useProxies'
import { useProfiles } from '../../profiles/hooks/useProfiles'
import type { ProxyFormValues, ProxyItem } from '../types'
import { normalizeProxy } from '../../../../../server/shared/proxy'
import { buildProxyUsage } from '../utils/proxyUsage'
import { useErrorHandler } from '@/hooks/useErrorHandler'

export function useProxiesPage() {
  const { proxies, loading } = useProxies()
  const { profiles } = useProfiles()
  const { handleError } = useErrorHandler()

  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editProxyId, setEditProxyId] = useState<string | null>(null)
  const [deleteProxyId, setDeleteProxyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const createProxy = useMutation(api.proxies.create)
  const updateProxy = useMutation(api.proxies.update)
  const deleteProxy = useMutation(api.proxies.remove)

  const editProxy = useMemo(
    () => (editProxyId ? proxies.find((p) => p.id === editProxyId) ?? null : null),
    [editProxyId, proxies],
  )
  const deleteTarget = useMemo(
    () => (deleteProxyId ? proxies.find((p) => p.id === deleteProxyId) ?? null : null),
    [deleteProxyId, proxies],
  )

  const filteredProxies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return proxies
    return proxies.filter((p) =>
      [p.name, p.proxy, p.proxyType].some((f) =>
        String(f ?? '').toLowerCase().includes(q),
      ),
    )
  }, [proxies, searchQuery])

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
          await createProxy({ name, proxy, proxyType, maxProfiles })
          setIsCreateOpen(false)
        } else if (editProxy) {
          await updateProxy({
            id: editProxy.id as Id<'proxies'>,
            name,
            proxy,
            proxyType,
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

  const usage = useMemo(() => buildProxyUsage(proxies, profiles), [proxies, profiles])

  return {
    proxies: filteredProxies,
    allProxies: proxies,
    usage,
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
