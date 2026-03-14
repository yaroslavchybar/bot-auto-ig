import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConvex, useMutation } from 'convex/react'
import { apiFetch } from '@/lib/api'
import type { LogEntry } from '@/lib/logs'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useProfiles } from './useProfiles'
import type { Profile } from '../types'
import { mapProfileRecord } from '../utils/mapProfile'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useIsMobile } from '@/hooks/use-mobile'

/* ── Dialog state management ── */

function useProfileDialogState(profiles: Profile[]) {
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  const [detailsProfileId, setDetailsProfileId] = useState<string | null>(null)
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null)
  const [logsProfileId, setLogsProfileId] = useState<string | null>(null)
  const [loginProfileId, setLoginProfileId] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const detailsProfile = useMemo(
    () => (detailsProfileId ? profiles.find((p) => p.id === detailsProfileId) ?? null : null),
    [detailsProfileId, profiles],
  )
  const deleteProfile = useMemo(
    () => (deleteProfileId ? profiles.find((p) => p.id === deleteProfileId) ?? null : null),
    [deleteProfileId, profiles],
  )
  const logsProfile = useMemo(
    () => (logsProfileId ? profiles.find((p) => p.id === logsProfileId) ?? null : null),
    [logsProfileId, profiles],
  )
  const loginProfile = useMemo(
    () => (loginProfileId ? profiles.find((p) => p.id === loginProfileId) ?? null : null),
    [loginProfileId, profiles],
  )

  return {
    editProfile, setEditProfile,
    detailsProfileId, setDetailsProfileId,
    deleteProfileId, setDeleteProfileId,
    logsProfileId, setLogsProfileId,
    loginProfileId, setLoginProfileId,
    isCreateOpen, setIsCreateOpen,
    detailsProfile, deleteProfile, logsProfile, loginProfile,
  }
}

/* ── Search + filtering ── */

function useProfileSearch(profiles: Profile[]) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return profiles
    return profiles.filter((profile) => {
      const status = profile.using ? 'active' : (profile.status ?? 'idle')
      const fields = [
        profile.name, profile.id, profile.proxy,
        profile.proxy_type, profile.fingerprint_os, status,
      ]
      return fields.some((field) =>
        String(field ?? '').toLowerCase().includes(query),
      )
    })
  }, [profiles, searchQuery])

  return { searchQuery, setSearchQuery, filteredProfiles }
}

/* ── Logs fetching ── */

function useProfileLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)

  const loadLogs = useCallback(async (profileName?: string) => {
    setLogsLoading(true)
    setLogsError(null)
    try {
      const data = await apiFetch<LogEntry[]>('/api/logs')
      const filtered = profileName
        ? data.filter((log) => {
            const structuredProfile = String(log.profileName || '').trim()
            return structuredProfile
              ? structuredProfile === profileName
              : String(log.message || '').includes(profileName)
          })
        : data
      setLogs(filtered.slice(-500))
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : String(e))
    } finally {
      setLogsLoading(false)
    }
  }, [])

  return { logs, logsLoading, logsError, loadLogs }
}

/* ── CRUD: Save handler ── */

function useProfileSave(
  dialogState: ReturnType<typeof useProfileDialogState>,
  refreshProfiles: () => Promise<void>,
) {
  const createProfile = useMutation(api.profiles.mutations.create)
  const updateProfile = useMutation(api.profiles.mutations.updateById)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSaveProfile = useCallback(async (data: Partial<Profile>) => {
    const name = String(data.name ?? '').trim()
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name,
        proxy: typeof data.proxy === 'string' ? data.proxy.trim() : '',
        proxyType: typeof data.proxy_type === 'string' ? data.proxy_type.trim() : '',
        fingerprintSeed: data.fingerprint_seed || undefined,
        fingerprintOs: data.fingerprint_os || undefined,
        cookiesJson: typeof data.cookies_json === 'string' ? data.cookies_json.trim() : '',
        testIp: Boolean(data.test_ip),
        dailyScrapingLimit:
          typeof data.daily_scraping_limit === 'number' ? data.daily_scraping_limit : null,
      }
      if (dialogState.isCreateOpen) {
        await createProfile(payload)
        await refreshProfiles()
        dialogState.setIsCreateOpen(false)
      } else if (dialogState.editProfile) {
        await updateProfile({
          profileId: dialogState.editProfile.id as Id<'profiles'>,
          ...payload,
        })
        await refreshProfiles()
        dialogState.setEditProfile(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [createProfile, dialogState, refreshProfiles, updateProfile])

  return { saving, setSaving, error, setError, handleSaveProfile }
}

/* ── CRUD: Delete + Toggle ── */

function useProfileCrud(
  dialogState: ReturnType<typeof useProfileDialogState>,
  refreshProfiles: () => Promise<void>,
  setSaving: (v: boolean) => void,
  setError: (v: string | null) => void,
) {
  const removeProfile = useMutation(api.profiles.mutations.removeById)

  const handleDeleteConfirm = useCallback(async () => {
    if (!dialogState.deleteProfile) return
    setSaving(true)
    setError(null)
    try {
      await removeProfile({ profileId: dialogState.deleteProfile.id as Id<'profiles'> })
      await refreshProfiles()
      dialogState.setDeleteProfileId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [dialogState, refreshProfiles, removeProfile, setError, setSaving])

  const toggleUsing = useCallback(async (profile: Profile) => {
    setSaving(true)
    setError(null)
    try {
      if (profile.using) {
        try {
          await apiFetch(
            `/api/profiles/${encodeURIComponent(profile.name)}/stop`,
            { method: 'POST' },
          )
        } catch { /* ignore */ }
      } else {
        await apiFetch(
          `/api/profiles/${encodeURIComponent(profile.name)}/start`,
          { method: 'POST' },
        )
      }
      await refreshProfiles()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [refreshProfiles, setError, setSaving])

  return { handleDeleteConfirm, toggleUsing }
}

/* ── Page action handlers ── */

function useProfilePageActions(
  convex: ReturnType<typeof useConvex>,
  dialogState: ReturnType<typeof useProfileDialogState>,
  crud: { setSaving: (v: boolean) => void; setError: (v: string | null) => void },
  clearWsLogs: () => void,
  refreshProfiles: () => Promise<void>,
) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefreshProfiles = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([refreshProfiles(), new Promise((resolve) => setTimeout(resolve, 300))])
    } finally {
      setRefreshing(false)
    }
  }, [refreshProfiles])

  const handleCreate = useCallback(() => {
    dialogState.setEditProfile(null)
    dialogState.setIsCreateOpen(true)
    crud.setError(null)
  }, [crud, dialogState])

  const handleEdit = useCallback(async (profile: Profile) => {
    dialogState.setDetailsProfileId(null)
    crud.setSaving(true)
    crud.setError(null)
    try {
      const fullProfile = await convex.query(api.profiles.queries.getById, {
        profileId: profile.id as Id<'profiles'>,
      })
      dialogState.setEditProfile(fullProfile ? mapProfileRecord(fullProfile) : null)
    } catch (e) {
      crud.setError(e instanceof Error ? e.message : String(e))
    } finally {
      crud.setSaving(false)
    }
  }, [convex, crud, dialogState])

  const handleDeleteClick = useCallback((profile: Profile) => {
    dialogState.setDeleteProfileId(profile.id)
    dialogState.setDetailsProfileId(null)
    crud.setError(null)
  }, [crud, dialogState])

  const handleLogs = useCallback((profile: Profile) => {
    dialogState.setLogsProfileId(profile.id)
    dialogState.setDetailsProfileId(null)
    crud.setError(null)
  }, [crud, dialogState])

  const handleDetails = useCallback((profile: Profile) => {
    dialogState.setDetailsProfileId(profile.id)
    crud.setError(null)
  }, [crud, dialogState])

  const handleCloseCreate = useCallback(() => {
    dialogState.setIsCreateOpen(false)
    crud.setError(null)
  }, [crud, dialogState])

  const handleCloseEdit = useCallback(() => {
    dialogState.setEditProfile(null)
    crud.setError(null)
  }, [crud, dialogState])

  const handleLogin = useCallback((profile: Profile) => {
    dialogState.setLoginProfileId(profile.id)
    dialogState.setDetailsProfileId(null)
    clearWsLogs()
    crud.setError(null)
  }, [clearWsLogs, crud, dialogState])

  return {
    refreshing, handleRefreshProfiles,
    handleCreate, handleEdit, handleDeleteClick,
    handleLogs, handleDetails, handleCloseCreate, handleCloseEdit, handleLogin,
  }
}

/* ── Runtime reconciliation effect ── */

function useRuntimeReconciliation(refreshProfiles: () => Promise<void>) {
  useEffect(() => {
    let active = true
    const reconcile = async () => {
      try {
        await apiFetch<{ success: boolean; cleared?: number; errors?: string[] }>(
          '/api/profiles/reconcile-runtime', { method: 'POST' },
        )
      } catch { /* ignore */ }
      if (active) await refreshProfiles()
    }
    void reconcile()
    return () => { active = false }
  }, [refreshProfiles])
}

/* ── Main hook ── */

export function useProfilesPage() {
  const convex = useConvex()
  const { profiles, loading: profilesLoading, refresh: refreshProfiles } = useProfiles()
  const isMobile = useIsMobile()

  const dialogState = useProfileDialogState(profiles)
  const { searchQuery, setSearchQuery, filteredProfiles } = useProfileSearch(profiles)
  const { logs, logsLoading, logsError, loadLogs } = useProfileLogs()

  const { logs: wsLogs, clearLogs: clearWsLogs } = useWebSocket({
    enabled: dialogState.loginProfileId !== null,
    pauseWhenHidden: true,
    maxBuffer: isMobile ? 250 : 500,
  })

  const save = useProfileSave(dialogState, refreshProfiles)
  const crud = useProfileCrud(dialogState, refreshProfiles, save.setSaving, save.setError)

  useRuntimeReconciliation(refreshProfiles)

  useEffect(() => {
    if (dialogState.logsProfile?.name) void loadLogs(dialogState.logsProfile.name)
  }, [dialogState.logsProfile?.name, loadLogs])

  const actions = useProfilePageActions(
    convex, dialogState,
    { setSaving: save.setSaving, setError: save.setError },
    clearWsLogs, refreshProfiles,
  )

  return {
    profiles, filteredProfiles, loading: profilesLoading,
    saving: save.saving, refreshing: actions.refreshing,
    isCreateOpen: dialogState.isCreateOpen,
    error: save.error ?? logsError,
    logs, logsLoading, searchQuery, wsLogs,
    editProfile: dialogState.editProfile,
    detailsProfile: dialogState.detailsProfile,
    deleteProfile: dialogState.deleteProfile,
    logsProfile: dialogState.logsProfile,
    loginProfile: dialogState.loginProfile,
    detailsProfileId: dialogState.detailsProfileId,
    logsProfileId: dialogState.logsProfileId,
    loginProfileId: dialogState.loginProfileId,
    setSearchQuery, setIsCreateOpen: dialogState.setIsCreateOpen,
    setDetailsProfileId: dialogState.setDetailsProfileId,
    setLogsProfileId: dialogState.setLogsProfileId,
    setLoginProfileId: dialogState.setLoginProfileId,
    handleRefreshProfiles: actions.handleRefreshProfiles,
    handleCreate: actions.handleCreate, handleEdit: actions.handleEdit,
    handleDeleteClick: actions.handleDeleteClick,
    handleLogs: actions.handleLogs, handleDetails: actions.handleDetails,
    handleCloseCreate: actions.handleCloseCreate,
    handleCloseEdit: actions.handleCloseEdit, handleLogin: actions.handleLogin,
    handleSaveProfile: save.handleSaveProfile,
    handleDeleteConfirm: crud.handleDeleteConfirm,
    toggleUsing: crud.toggleUsing, refreshProfiles, loadLogs,
  }
}
