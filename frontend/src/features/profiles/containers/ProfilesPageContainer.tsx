import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConvex, useMutation } from 'convex/react'
import { apiFetch } from '@/lib/api'
import type { LogEntry } from '@/lib/logs'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { useProfiles } from '@/features/profiles/hooks/useProfiles'
import { ProfileDetails } from '../components/ProfileDetails'
import { ProfileForm } from '../components/ProfileForm'
import { ProfileLogs } from '../components/ProfileLogs'
import { ProfilesList } from '../components/ProfilesList'
import { LoginDialog } from '../components/LoginDialog'
import type { Profile } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIsMobile } from '@/hooks/use-mobile'
import { Plus, RefreshCw, Search, Terminal } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useWebSocket } from '@/hooks/useWebSocket'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { mapProfileRecord } from '../lib/mapProfile'

export function ProfilesPageContainer() {
  const convex = useConvex()
  const createProfile = useMutation(api.profiles.create)
  const updateProfile = useMutation(api.profiles.updateById)
  const removeProfile = useMutation(api.profiles.removeById)
  const {
    profiles,
    loading: profilesLoading,
    refresh: refreshProfiles,
  } = useProfiles()
  const isMobile = useIsMobile()
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  const [detailsProfileId, setDetailsProfileId] = useState<string | null>(null)
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null)
  const [logsProfileId, setLogsProfileId] = useState<string | null>(null)
  const [loginProfileId, setLoginProfileId] = useState<string | null>(null)

  // Local loading state for actions (save, delete, etc)
  const loading = profilesLoading
  const [saving, setSaving] = useState(false)

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const { logs: wsLogs, clearLogs: clearWsLogs } = useWebSocket({
    enabled: loginProfileId !== null,
    pauseWhenHidden: true,
    maxBuffer: isMobile ? 250 : 500,
  })

  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    if (!query) return profiles

    return profiles.filter((profile) => {
      const status = profile.using ? 'active' : (profile.status ?? 'idle')
      const fields = [
        profile.name,
        profile.id,
        profile.proxy,
        profile.proxy_type,
        profile.fingerprint_os,
        status,
      ]

      return fields.some((field) =>
        String(field ?? '')
          .toLowerCase()
          .includes(query),
      )
    })
  }, [profiles, searchQuery])
  const detailsProfile =
    profiles.find((profile) => profile.id === detailsProfileId) ?? null
  const deleteProfile =
    profiles.find((profile) => profile.id === deleteProfileId) ?? null
  const logsProfile =
    profiles.find((profile) => profile.id === logsProfileId) ?? null
  const loginProfile =
    profiles.find((profile) => profile.id === loginProfileId) ?? null

  // On page mount, reconcile stale runtime status left after app/container restarts.
  useEffect(() => {
    let active = true

    const reconcileRuntimeState = async () => {
      try {
        await apiFetch<{
          success: boolean
          cleared?: number
          errors?: string[]
        }>('/api/profiles/reconcile-runtime', { method: 'POST' })
      } catch {
        // Ignore reconcile errors here; regular refresh below still runs.
      }

      if (active) {
        await refreshProfiles()
      }
    }

    void reconcileRuntimeState()

    return () => {
      active = false
    }
  }, [refreshProfiles])

  useEffect(() => {
    if (detailsProfileId && !detailsProfile) {
      setDetailsProfileId(null)
    }
    if (deleteProfileId && !deleteProfile) {
      setDeleteProfileId(null)
    }
    if (logsProfileId && !logsProfile) {
      setLogsProfileId(null)
      setLogs([])
    }
    if (loginProfileId && !loginProfile) {
      setLoginProfileId(null)
    }
    if (editProfile && !profiles.find((profile) => profile.id === editProfile.id)) {
      setEditProfile(null)
    }
  }, [
    deleteProfile,
    deleteProfileId,
    detailsProfile,
    detailsProfileId,
    editProfile,
    loginProfile,
    loginProfileId,
    logsProfile,
    logsProfileId,
    profiles,
  ])

  const loadLogs = useCallback(async (profileName?: string) => {
    setLogsLoading(true)
    setError(null)
    try {
      const data = await apiFetch<LogEntry[]>('/api/logs')
      const filtered = profileName
        ? data.filter((l) => String(l.message).includes(profileName))
        : data
      setLogs(filtered.slice(-500))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (logsProfile?.name) {
      void loadLogs(logsProfile.name)
    }
  }, [logsProfile?.name, loadLogs])

  const handleCreate = () => {
    setEditProfile(null)
    setIsCreateOpen(true)
    setError(null)
  }

  const handleEdit = async (profile: Profile) => {
    setDetailsProfileId(null)
    setSaving(true)
    setError(null)
    try {
      const fullProfile = await convex.query(api.profiles.getById, {
        profileId: profile.id as Id<'profiles'>,
      })
      setEditProfile(fullProfile ? mapProfileRecord(fullProfile) : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteClick = (profile: Profile) => {
    setDeleteProfileId(profile.id)
    setDetailsProfileId(null)
    setError(null)
  }

  const handleLogs = (profile: Profile) => {
    setLogsProfileId(profile.id)
    setDetailsProfileId(null)
    setError(null)
  }

  const handleDetails = (profile: Profile) => {
    setDetailsProfileId(profile.id)
    setError(null)
  }

  const handleCloseCreate = () => {
    setIsCreateOpen(false)
    setError(null)
  }

  const handleCloseEdit = () => {
    setEditProfile(null)
    setError(null)
  }

  const handleLogin = (profile: Profile) => {
    setLoginProfileId(profile.id)
    setDetailsProfileId(null)
    clearWsLogs()
    setError(null)
  }

  const handleSaveProfile = async (data: Partial<Profile>) => {
    const name = String(data.name ?? '').trim()

    setSaving(true)
    setError(null)
    try {
      if (isCreateOpen) {
        await createProfile({
          name,
          proxy: typeof data.proxy === 'string' ? data.proxy.trim() : '',
          proxyType:
            typeof data.proxy_type === 'string' ? data.proxy_type.trim() : '',
          fingerprintSeed: data.fingerprint_seed || undefined,
          fingerprintOs: data.fingerprint_os || undefined,
          cookiesJson:
            typeof data.cookies_json === 'string' ? data.cookies_json.trim() : '',
          testIp: Boolean(data.test_ip),
          dailyScrapingLimit:
            typeof data.daily_scraping_limit === 'number'
              ? data.daily_scraping_limit
              : null,
        })
        await refreshProfiles()
        setIsCreateOpen(false)
      } else if (editProfile) {
        await updateProfile({
          profileId: editProfile.id as Id<'profiles'>,
          name,
          proxy: typeof data.proxy === 'string' ? data.proxy.trim() : '',
          proxyType:
            typeof data.proxy_type === 'string' ? data.proxy_type.trim() : '',
          fingerprintSeed: data.fingerprint_seed || undefined,
          fingerprintOs: data.fingerprint_os || undefined,
          cookiesJson:
            typeof data.cookies_json === 'string' ? data.cookies_json.trim() : '',
          testIp: Boolean(data.test_ip),
          dailyScrapingLimit:
            typeof data.daily_scraping_limit === 'number'
              ? data.daily_scraping_limit
              : null,
        })
        await refreshProfiles()
        setEditProfile(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteProfile) return
    setSaving(true)
    setError(null)
    try {
      await removeProfile({
        profileId: deleteProfile.id as Id<'profiles'>,
      })
      await refreshProfiles()
      setDeleteProfileId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleUsing = async (profile: Profile) => {
    setSaving(true)
    setError(null)
    try {
      if (profile.using) {
        try {
          await apiFetch(
            `/api/profiles/${encodeURIComponent(profile.name)}/stop`,
            { method: 'POST' },
          )
        } catch {
          // ignore
        }
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
  }

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />
      {/* Header */}
      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
          <div className="flex flex-grow items-center gap-2">
            <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search..."
                className="bg-field border border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pl-9 text-sm font-normal leading-5 shadow-sm"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refreshProfiles()}
              disabled={loading || saving}
              aria-label="Refresh profiles"
              title="Refresh profiles"
              className="h-8 w-8 shrink-0 p-0"
            >
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
          <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
            <Button
              size="icon"
              onClick={handleCreate}
              disabled={loading || saving}
              className="mobile-effect-shadow brand-button h-8 w-auto px-3.5 text-sm"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Profile
            </Button>
          </div>
        </div>
      </div>

      {error &&
        !deleteProfile &&
        !isCreateOpen &&
        !editProfile &&
        !logsProfile &&
        !detailsProfile && (
          <div className="status-banner-danger flex items-center border-b px-4 py-3 text-sm md:px-6">
            <span className="status-dot-danger mr-2 h-1.5 w-1.5 rounded-full" />
            {error}
          </div>
        )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px] space-y-4">
          <ProfilesList
            profiles={filteredProfiles}
            loading={loading}
            onDetails={handleDetails}
            onEdit={handleEdit}
            onDelete={handleDeleteClick}
            onLogs={handleLogs}
            onToggleStatus={(p) => toggleUsing(p)}
            onLogin={handleLogin}
            emptyTitle={
              searchQuery.trim() ? 'No matching profiles' : 'No profiles'
            }
            emptyDescription={
              searchQuery.trim()
                ? 'Try a different search term or clear the filter.'
                : 'Create a new profile to get started.'
            }
          />
        </div>
      </div>

      {/* Dialogs & Sheets */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open)
          if (!open) setError(null)
        }}
      >
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">
              Create Profile
            </DialogTitle>
          </DialogHeader>
          <ProfileForm
            key={isCreateOpen ? 'profile-create-open' : 'profile-create-closed'}
            mode="create"
            existingNames={profiles.map((p) => p.name)}
            saving={saving}
            onSave={handleSaveProfile}
            onCancel={handleCloseCreate}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editProfile)}
        onOpenChange={(open) => {
          if (!open) handleCloseEdit()
        }}
      >
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">
              Edit Profile
            </DialogTitle>
          </DialogHeader>
          {editProfile && (
            <ProfileForm
              key={editProfile.id}
              mode="edit"
              initialData={editProfile}
              existingNames={profiles.map((p) => p.name)}
              saving={saving}
              onSave={handleSaveProfile}
              onCancel={handleCloseEdit}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(logsProfile)}
        onOpenChange={(open) => {
          if (!open) setLogsProfileId(null)
        }}
      >
        <DialogContent className="bg-panel border-line text-ink flex h-[80vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-line-soft border-b p-6 pb-2">
            <DialogTitle className="page-title-gradient flex items-center gap-2">
              <Terminal className="text-copy h-5 w-5" />
              Logs:{' '}
              <span className="text-muted-copy font-mono">
                {logsProfile?.name}
              </span>
            </DialogTitle>
          </DialogHeader>
          {logsProfile && (
            <ProfileLogs
              logs={logs}
              loading={logsLoading}
              onRefresh={() => loadLogs(logsProfile.name)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Sheet
        open={Boolean(detailsProfile)}
        onOpenChange={(open) => {
          if (!open) setDetailsProfileId(null)
        }}
      >
        <SheetContent className="border-line bg-panel text-ink flex w-full max-w-full flex-col gap-0 border-l p-0 shadow-xl sm:w-[540px]">
          <SheetHeader className="border-line-soft bg-panel-subtle border-b p-6 pb-4">
            <SheetTitle className="page-title-gradient">
              Profile Details
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {detailsProfile ? (
              <ProfileDetails profile={detailsProfile} />
            ) : (
              <div className="text-muted-foreground p-8 text-center text-sm">
                Profile unavailable.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {
        deleteProfile ? (
          <ConfirmDeleteDialog
            open={Boolean(deleteProfile)}
            title="Delete Profile?"
            entityLabel="and its data"
            itemName={deleteProfile.name}
            confirmLabel="Delete Profile"
            saving={saving}
            error={error}
            onConfirm={handleDeleteConfirm}
            onCancel={() => setDeleteProfileId(null)}
          />
        ) : null
      }

      <LoginDialog
        open={Boolean(loginProfile)}
        profile={loginProfile}
        logs={wsLogs}
        onClose={() => setLoginProfileId(null)}
        onSuccess={refreshProfiles}
      />
    </div >
  )
}




