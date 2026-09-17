import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useErrorHandler } from '@/hooks/useErrorHandler'

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
        profile.proxyType, profile.fingerprintOs, status,
      ]
      return fields.some((field) =>
        String(field ?? '').toLowerCase().includes(query),
      )
    })
  }, [profiles, searchQuery])

  return { searchQuery, setSearchQuery, filteredProfiles }
}

/* ── Logs fetching ── */

function useProfileLogs(handleError: ReturnType<typeof useErrorHandler>['handleError']) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const requestVersion = useRef(0)

  const loadLogs = useCallback(async (profileName?: string) => {
    const version = ++requestVersion.current
    setLogsLoading(true)
    try {
      const data = await apiFetch<LogEntry[]>('/api/logs')
      if (version !== requestVersion.current) return
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
      if (version === requestVersion.current) handleError(e, 'Profile logs')
    } finally {
      if (version === requestVersion.current) setLogsLoading(false)
    }
  }, [handleError])

  return { logs, logsLoading, loadLogs }
}

/* ── CRUD: Save handler ── */

function useProfileSave(
  dialogState: ReturnType<typeof useProfileDialogState>,
  refreshProfiles: () => Promise<void>,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const createProfile = useMutation(api.profiles.mutations.create)
  const updateProfile = useMutation(api.profiles.mutations.updateById)
  const [saving, setSaving] = useState(false)

  const handleSaveProfile = useCallback(async (data: Partial<Profile>) => {
    const name = String(data.name ?? '').trim()
    setSaving(true)
    try {
      const payload = {
        name,
        proxy: typeof data.proxy === 'string' ? data.proxy.trim() : '',
        proxyType: typeof data.proxyType === 'string' ? data.proxyType.trim() : '',
        fingerprintOs: data.fingerprintOs || undefined,
        cookiesJson: typeof data.cookiesJson === 'string' ? data.cookiesJson.trim() : '',
        testIp: Boolean(data.testIp),
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
      handleError(e, 'Save profile')
    } finally {
      setSaving(false)
    }
  }, [createProfile, dialogState, handleError, refreshProfiles, updateProfile])

  return { saving, setSaving, handleSaveProfile }
}

/* ── CRUD: Delete + Toggle ── */

function useProfileCrud(
  dialogState: ReturnType<typeof useProfileDialogState>,
  refreshProfiles: () => Promise<void>,
  setSaving: (v: boolean) => void,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const handleDeleteConfirm = useCallback(async () => {
    if (!dialogState.deleteProfile) return
    setSaving(true)
    try {
      // Delete via backend so the DB row and data/profiles/<name> go together.
      // (Direct Convex removeById leaves the browser folder behind.)
      await apiFetch(
        `/api/profiles/${encodeURIComponent(dialogState.deleteProfile.name)}`,
        { method: 'DELETE' },
      )
      await refreshProfiles()
      dialogState.setDeleteProfileId(null)
    } catch (e) {
      handleError(e, 'Delete profile')
    } finally {
      setSaving(false)
    }
  }, [dialogState, refreshProfiles, handleError, setSaving])

  const toggleUsing = useCallback(async (profile: Profile) => {
    setSaving(true)
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
      handleError(e, 'Toggle profile')
    } finally {
      setSaving(false)
    }
  }, [refreshProfiles, handleError, setSaving])

  return { handleDeleteConfirm, toggleUsing }
}

/* ── Page action handlers ── */

function useProfilePageActions(
  convex: ReturnType<typeof useConvex>,
  dialogState: ReturnType<typeof useProfileDialogState>,
  setSaving: (v: boolean) => void,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
  clearWsLogs: () => void,
) {
  const handleCreate = useCallback(() => {
    dialogState.setEditProfile(null)
    dialogState.setIsCreateOpen(true)
  }, [dialogState])

  const handleEdit = useCallback(async (profile: Profile) => {
    dialogState.setDetailsProfileId(null)
    setSaving(true)
    try {
      const fullProfile = await convex.query(api.profiles.queries.getById, {
        profileId: profile.id as Id<'profiles'>,
      })
      dialogState.setEditProfile(fullProfile ? mapProfileRecord(fullProfile, { includeCookies: true }) : null)
    } catch (e) {
      handleError(e, 'Load profile')
    } finally {
      setSaving(false)
    }
  }, [convex, dialogState, handleError, setSaving])

  const handleDeleteClick = useCallback((profile: Profile) => {
    dialogState.setDeleteProfileId(profile.id)
    dialogState.setDetailsProfileId(null)
  }, [dialogState])

  const handleLogs = useCallback((profile: Profile) => {
    dialogState.setLogsProfileId(profile.id)
    dialogState.setDetailsProfileId(null)
  }, [dialogState])

  const handleDetails = useCallback((profile: Profile) => {
    dialogState.setDetailsProfileId(profile.id)
  }, [dialogState])

  const handleCloseCreate = useCallback(() => {
    dialogState.setIsCreateOpen(false)
  }, [dialogState])

  const handleCloseEdit = useCallback(() => {
    dialogState.setEditProfile(null)
  }, [dialogState])

  const handleLogin = useCallback((profile: Profile) => {
    dialogState.setLoginProfileId(profile.id)
    dialogState.setDetailsProfileId(null)
    clearWsLogs()
  }, [clearWsLogs, dialogState])

  return {
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
  const { handleError } = useErrorHandler()

  const dialogState = useProfileDialogState(profiles)
  const { searchQuery, setSearchQuery, filteredProfiles } = useProfileSearch(profiles)
  const { logs, logsLoading, loadLogs } = useProfileLogs(handleError)

  const { logs: wsLogs, clearLogs: clearWsLogs } = useWebSocket({
    enabled: dialogState.loginProfileId !== null,
    pauseWhenHidden: true,
    maxBuffer: isMobile ? 250 : 500,
  })

  const save = useProfileSave(dialogState, refreshProfiles, handleError)
  const crud = useProfileCrud(dialogState, refreshProfiles, save.setSaving, handleError)

  useRuntimeReconciliation(refreshProfiles)

  useEffect(() => {
    const name = dialogState.logsProfile?.name
    if (!name) return
    void loadLogs(name)
    // Auto-refresh while the dialog stays open; no manual button.
    const timer = setInterval(() => { void loadLogs(name) }, 5000)
    return () => clearInterval(timer)
  }, [dialogState.logsProfile?.name, loadLogs])

  const actions = useProfilePageActions(
    convex, dialogState, save.setSaving, handleError,
    clearWsLogs,
  )

  return {
    profiles, filteredProfiles, loading: profilesLoading,
    saving: save.saving,
    isCreateOpen: dialogState.isCreateOpen,
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
    setDeleteProfileId: dialogState.setDeleteProfileId,
    setLogsProfileId: dialogState.setLogsProfileId,
    setLoginProfileId: dialogState.setLoginProfileId,
    handleCreate: actions.handleCreate, handleEdit: actions.handleEdit,
    handleDeleteClick: actions.handleDeleteClick,
    handleLogs: actions.handleLogs, handleDetails: actions.handleDetails,
    handleCloseCreate: actions.handleCloseCreate,
    handleCloseEdit: actions.handleCloseEdit, handleLogin: actions.handleLogin,
    handleSaveProfile: save.handleSaveProfile,
    handleDeleteConfirm: crud.handleDeleteConfirm,
    toggleUsing: crud.toggleUsing, refreshProfiles,
  }
}
