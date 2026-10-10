import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { apiFetch } from '@/lib/api'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useCursorPage, useDebouncedSearch } from '@/hooks/use-cursor-page'
import { DEFAULT_PAGE_SIZE, type PageSize } from '../../../../../server/shared/pagination'
import type { Profile } from '../types'
import { mapProfileRecord } from '../utils/mapProfile'
import { getCookieUpdate } from '../utils/cookieJson'
import { useErrorHandler } from '@/hooks/useErrorHandler'

/* ── Dialog state management ── */

function useProfileDialogState(profiles: Profile[]) {
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const deleteProfile = useMemo(
    () => (deleteProfileId ? (profiles.find((p) => p.id === deleteProfileId) ?? null) : null),
    [deleteProfileId, profiles],
  )
  return {
    editProfile,
    setEditProfile,
    deleteProfileId,
    setDeleteProfileId,
    isCreateOpen,
    setIsCreateOpen,
    deleteProfile,
  }
}

/* ── Search + filtering ── */

/* ── CRUD: Save handler ── */

function useProfileSave(
  dialogState: ReturnType<typeof useProfileDialogState>,
  refreshProfiles: () => Promise<void>,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const createProfile = useMutation(api.profiles.mutations.create)
  const [saving, setSaving] = useState(false)

  const handleSaveProfile = useCallback(
    async (data: Partial<Profile>) => {
      const name = String(data.name ?? '').trim()
      setSaving(true)
      try {
        const payload = {
          name,
          proxy: typeof data.proxy === 'string' ? data.proxy.trim() : '',
          proxyType: typeof data.proxyType === 'string' ? data.proxyType.trim() : '',
          fingerprintOs: data.fingerprintOs || undefined,
          cookiesJson: dialogState.isCreateOpen
            ? data.cookiesJson?.trim()
            : getCookieUpdate(data.cookiesJson, dialogState.editProfile?.cookiesJson),
        }
        if (dialogState.isCreateOpen) {
          await createProfile(payload)
          await refreshProfiles()
          dialogState.setIsCreateOpen(false)
        } else if (dialogState.editProfile) {
          await apiFetch(`/api/profiles/${encodeURIComponent(dialogState.editProfile.name)}`, {
            method: 'PUT',
            body: payload,
          })
          await refreshProfiles()
          dialogState.setEditProfile(null)
        }
      } catch (e) {
        handleError(e, 'Save profile')
      } finally {
        setSaving(false)
      }
    },
    [createProfile, dialogState, handleError, refreshProfiles],
  )

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
      await apiFetch(`/api/profiles/${encodeURIComponent(dialogState.deleteProfile.name)}`, {
        method: 'DELETE',
      })
      await refreshProfiles()
      dialogState.setDeleteProfileId(null)
    } catch (e) {
      handleError(e, 'Delete profile')
    } finally {
      setSaving(false)
    }
  }, [dialogState, refreshProfiles, handleError, setSaving])

  const toggleUsing = useCallback(
    async (profile: Profile) => {
      setSaving(true)
      try {
        if (profile.using) {
          try {
            await apiFetch(`/api/profiles/${encodeURIComponent(profile.name)}/stop`, {
              method: 'POST',
            })
          } catch {
            /* ignore */
          }
        } else {
          await apiFetch(`/api/profiles/${encodeURIComponent(profile.name)}/start`, {
            method: 'POST',
          })
        }
        await refreshProfiles()
      } catch (e) {
        handleError(e, 'Toggle profile')
      } finally {
        setSaving(false)
      }
    },
    [refreshProfiles, handleError, setSaving],
  )

  return { handleDeleteConfirm, toggleUsing }
}

/* ── Page action handlers ── */

function useProfilePageActions(
  convex: ReturnType<typeof useConvex>,
  dialogState: ReturnType<typeof useProfileDialogState>,
  setSaving: (v: boolean) => void,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const handleCreate = useCallback(() => {
    dialogState.setEditProfile(null)
    dialogState.setIsCreateOpen(true)
  }, [dialogState])

  const handleEdit = useCallback(
    async (profile: Profile) => {
      setSaving(true)
      try {
        const fullProfile = await convex.query(api.profiles.queries.getById, {
          profileId: profile.id as Id<'profiles'>,
        })
        dialogState.setEditProfile(
          fullProfile ? mapProfileRecord(fullProfile, { includeCookies: true }) : null,
        )
      } catch (e) {
        handleError(e, 'Load profile')
      } finally {
        setSaving(false)
      }
    },
    [convex, dialogState, handleError, setSaving],
  )

  const handleDeleteClick = useCallback(
    (profile: Profile) => {
      dialogState.setDeleteProfileId(profile.id)
    },
    [dialogState],
  )

  const handleCloseCreate = useCallback(() => {
    dialogState.setIsCreateOpen(false)
  }, [dialogState])

  const handleCloseEdit = useCallback(() => {
    dialogState.setEditProfile(null)
  }, [dialogState])

  return {
    handleCreate,
    handleEdit,
    handleDeleteClick,
    handleCloseCreate,
    handleCloseEdit,
  }
}

/* ── Runtime reconciliation effect ── */

function useRuntimeReconciliation() {
  useEffect(() => {
    const reconcile = async () => {
      try {
        await apiFetch<{ success: boolean; cleared?: number; errors?: string[] }>(
          '/api/profiles/reconcile-runtime',
          { method: 'POST' },
        )
      } catch {
        /* ignore */
      }
    }
    void reconcile()
  }, [])
}

/* ── Main hook ── */

export function useProfilesPage() {
  const convex = useConvex()
  const [searchQuery, setSearchQuery] = useState('')
  const search = useDebouncedSearch(searchQuery)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const pagination = useCursorPage(JSON.stringify([search, pageSize]))
  const args = { search, cursor: pagination.cursor, pageSize }
  const data = useQuery(api.profiles.queries.listPage, args)
  const profiles = useMemo(() => data?.page.map((row) => mapProfileRecord(row)) ?? [], [data])
  const profilesLoading = data === undefined
  const refreshProfiles = useCallback(async () => {
    await convex.query(api.profiles.queries.listPage, {
      search,
      cursor: pagination.cursor,
      pageSize,
    })
  }, [convex, search, pagination.cursor, pageSize])
  const filteredProfiles = profiles
  const { handleError } = useErrorHandler()

  const dialogState = useProfileDialogState(profiles)

  const save = useProfileSave(dialogState, refreshProfiles, handleError)
  const crud = useProfileCrud(dialogState, refreshProfiles, save.setSaving, handleError)

  useRuntimeReconciliation()

  const actions = useProfilePageActions(convex, dialogState, save.setSaving, handleError)

  return {
    pagination: {
      ...pagination,
      hasNext: data !== undefined && !data.isDone,
      loading: profilesLoading,
      next: () => {
        if (data && !data.isDone) pagination.next(data.continueCursor)
      },
    },
    profiles,
    filteredProfiles,
    pageSize,
    setPageSize,
    loading: profilesLoading,
    saving: save.saving,
    isCreateOpen: dialogState.isCreateOpen,
    searchQuery,
    editProfile: dialogState.editProfile,
    deleteProfile: dialogState.deleteProfile,
    setSearchQuery,
    setIsCreateOpen: dialogState.setIsCreateOpen,
    setDeleteProfileId: dialogState.setDeleteProfileId,
    handleCreate: actions.handleCreate,
    handleEdit: actions.handleEdit,
    handleDeleteClick: actions.handleDeleteClick,
    handleCloseCreate: actions.handleCloseCreate,
    handleCloseEdit: actions.handleCloseEdit,
    handleSaveProfile: save.handleSaveProfile,
    handleDeleteConfirm: crud.handleDeleteConfirm,
    toggleUsing: crud.toggleUsing,
    refreshProfiles,
  }
}
