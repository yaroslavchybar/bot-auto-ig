import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { apiFetch } from '@/lib/api'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useCursorPage, useDebouncedSearch, usePageSize } from '@/hooks/use-cursor-page'
import type { Profile, ProfileEditValues } from '../types'
import { mapProfileRecord } from '../utils/mapProfile'
import { getCookieUpdate } from '../utils/cookieJson'
import { useErrorHandler } from '@/hooks/useErrorHandler'

type SetSaving = (active: boolean, generation?: number) => void

/* ── Dialog state management ── */

function useProfileDialogState(profiles: Profile[]) {
  const generationRef = useRef(0)
  const [generation, setGeneration] = useState(0)
  const beginDialog = useCallback(() => {
    const next = ++generationRef.current
    setGeneration(next)
    return next
  }, [])
  const ownsDialog = useCallback((value: number) => generationRef.current === value, [])
  useEffect(() => () => { generationRef.current++ }, [])
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const deleteProfile = useMemo(
    () => (deleteProfileId ? (profiles.find((p) => p.id === deleteProfileId) ?? null) : null),
    [deleteProfileId, profiles],
  )
  return {
    generation,
    beginDialog,
    ownsDialog,
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
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const [pending, setPending] = useState(new Map<number, number>())
  // Page-wide work uses -1; an older editor's work cannot disable a newer dialog.
  const setSaving: SetSaving = useCallback((active, generation = -1) => setPending(current => {
    const next = new Map(current)
    const count = Math.max(0, (next.get(generation) ?? 0) + (active ? 1 : -1))
    if (count) next.set(generation, count)
    else next.delete(generation)
    return next
  }), [])

  const handleSaveProfile = useCallback(
    async (data: ProfileEditValues) => {
      const generation = dialogState.generation
      const ownsDialog = () => dialogState.ownsDialog(generation)
      const profile = dialogState.editProfile
      if (!ownsDialog() || !profile) return
      const name = String(data.name ?? '').trim()
      setSaving(true, generation)
      try {
        const payload = {
          name,
          proxy: typeof data.proxy === 'string' ? data.proxy.trim() : '',
          proxyType: typeof data.proxyType === 'string' ? data.proxyType.trim() : '',
          fingerprintOs: data.fingerprintOs || undefined,
          cookiesJson: getCookieUpdate(data.cookiesJson, profile.cookiesJson),
        }
        await apiFetch(`/api/profiles/${encodeURIComponent(profile.name)}`, {
          method: 'PUT',
          body: payload,
        })
        if (ownsDialog()) dialogState.setEditProfile(null)
      } catch (e) {
        if (ownsDialog()) handleError(e, 'Save profile')
      } finally {
        setSaving(false, generation)
      }
    },
    [dialogState, handleError, setSaving],
  )

  return { saving: (pending.get(-1) ?? 0) > 0 || (pending.get(dialogState.generation) ?? 0) > 0, setSaving, handleSaveProfile }
}

/* ── CRUD: Delete + Toggle ── */

function useProfileCrud(
  dialogState: ReturnType<typeof useProfileDialogState>,
  setSaving: SetSaving,
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
      dialogState.setDeleteProfileId(null)
    } catch (e) {
      handleError(e, 'Delete profile')
    } finally {
      setSaving(false)
    }
  }, [dialogState, handleError, setSaving])

  const toggleUsing = useCallback(
    async (profile: Profile) => {
      setSaving(true)
      try {
        if (profile.inUse) {
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
      } catch (e) {
        handleError(e, 'Toggle profile')
      } finally {
        setSaving(false)
      }
    },
    [handleError, setSaving],
  )

  return { handleDeleteConfirm, toggleUsing }
}

/* ── Page action handlers ── */

function useProfilePageActions(
  convex: ReturnType<typeof useConvex>,
  dialogState: ReturnType<typeof useProfileDialogState>,
  setSaving: SetSaving,
  handleError: ReturnType<typeof useErrorHandler>['handleError'],
) {
  const renderedGeneration = dialogState.generation
  const handleCreate = useCallback(() => {
    dialogState.beginDialog()
    dialogState.setEditProfile(null)
    dialogState.setIsCreateOpen(true)
  }, [dialogState])

  const handleEdit = useCallback(
    async (profile: Profile) => {
      const generation = dialogState.beginDialog()
      dialogState.setIsCreateOpen(false)
      dialogState.setEditProfile(null)
      setSaving(true, generation)
      try {
        const fullProfile = await convex.query(api.profiles.queries.getById, {
          profileId: profile.id as Id<'profiles'>,
        })
        if (dialogState.ownsDialog(generation))
          dialogState.setEditProfile(fullProfile ? mapProfileRecord(fullProfile, { includeCookies: true }) : null)
      } catch (e) {
        if (dialogState.ownsDialog(generation)) handleError(e, 'Load profile')
      } finally {
        setSaving(false, generation)
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
    if (!dialogState.ownsDialog(renderedGeneration)) return
    dialogState.beginDialog()
    dialogState.setIsCreateOpen(false)
  }, [dialogState, renderedGeneration])

  const handleCloseEdit = useCallback(() => {
    if (!dialogState.ownsDialog(renderedGeneration)) return
    dialogState.beginDialog()
    dialogState.setEditProfile(null)
  }, [dialogState, renderedGeneration])

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
  const [pageSize, setPageSize] = usePageSize('profiles')
  const pagination = useCursorPage(JSON.stringify([search, pageSize]))
  const args = { search, cursor: pagination.cursor, pageSize }
  const data = useQuery(api.profiles.queries.listPage, args)
  const profiles = useMemo(() => data?.page.map((row) => mapProfileRecord(row)) ?? [], [data])
  const profilesLoading = data === undefined
  const filteredProfiles = profiles
  const { handleError } = useErrorHandler()

  const dialogState = useProfileDialogState(profiles)

  const save = useProfileSave(dialogState, handleError)
  const crud = useProfileCrud(dialogState, save.setSaving, handleError)

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
    setIsCreateOpen: (open: boolean) => open ? actions.handleCreate() : actions.handleCloseCreate(),
    setDeleteProfileId: dialogState.setDeleteProfileId,
    handleCreate: actions.handleCreate,
    handleEdit: actions.handleEdit,
    handleDeleteClick: actions.handleDeleteClick,
    handleCloseCreate: actions.handleCloseCreate,
    handleCloseEdit: actions.handleCloseEdit,
    handleSaveProfile: save.handleSaveProfile,
    handleDeleteConfirm: crud.handleDeleteConfirm,
    toggleUsing: crud.toggleUsing,
  }
}
