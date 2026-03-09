import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { LogEntry } from '@/lib/logs'
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

export function ProfilesPageContainer() {
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
      const fullProfile = await apiFetch<Profile>(
        `/api/profiles/by-id?profileId=${encodeURIComponent(profile.id)}`,
      )
      setEditProfile(fullProfile)
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
        await apiFetch('/api/profiles', {
          method: 'POST',
          body: {
            name,
            proxy:
              typeof data.proxy === 'string' ? data.proxy.trim() : undefined,
            proxy_type:
              typeof data.proxy_type === 'string'
                ? data.proxy_type.trim()
                : undefined,
            fingerprint_seed: data.fingerprint_seed || undefined,
            fingerprint_os: data.fingerprint_os || undefined,
            cookies_json:
              typeof data.cookies_json === 'string'
                ? data.cookies_json.trim()
                : '',
            test_ip: Boolean(data.test_ip),
            daily_scraping_limit:
              typeof data.daily_scraping_limit === 'number'
                ? data.daily_scraping_limit
                : null,
          },
        })
        await refreshProfiles()
        setIsCreateOpen(false)
      } else if (editProfile) {
        await apiFetch(
          `/api/profiles/${encodeURIComponent(editProfile.name)}`,
          {
            method: 'PUT',
            body: {
              name,
              proxy:
                typeof data.proxy === 'string' ? data.proxy.trim() : undefined,
              proxy_type:
                typeof data.proxy_type === 'string'
                  ? data.proxy_type.trim()
                  : undefined,
              fingerprint_seed: data.fingerprint_seed || undefined,
              fingerprint_os: data.fingerprint_os || undefined,
              cookies_json:
                typeof data.cookies_json === 'string'
                  ? data.cookies_json.trim()
                  : '',
              test_ip: Boolean(data.test_ip),
              daily_scraping_limit:
                typeof data.daily_scraping_limit === 'number'
                  ? data.daily_scraping_limit
                  : null,
            },
          },
        )
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
      await apiFetch(`/api/profiles/${encodeURIComponent(deleteProfile.name)}`, {
        method: 'DELETE',
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
      <div className="mobile-effect-blur mobile-effect-sticky border-line-soft bg-panel-subtle sticky top-0 z-10 border-b backdrop-blur-xs">
        <div className="flex flex-col gap-4 px-4 py-4 md:px-6 xl:flex-row xl:items-center xl:gap-6">
          <div className="relative w-full xl:max-w-xl xl:flex-1">
            <Search className="text-subtle-copy pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search profiles..."
              className="brand-focus brand-focus-strong border-line bg-panel-strong text-inverse placeholder:text-subtle-copy h-11 rounded-xl pl-10"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between xl:ml-auto xl:justify-end">
            <Button
              size={isMobile ? 'default' : 'sm'}
              onClick={handleCreate}
              disabled={loading || saving}
              className="mobile-effect-shadow brand-button w-full font-medium sm:w-auto"
            >
              <Plus className={isMobile ? 'h-4 w-4' : 'mr-2 h-3.5 w-3.5'} />
              New Profile
            </Button>
            <Button
              variant="outline"
              size={isMobile ? 'default' : 'sm'}
              onClick={() => refreshProfiles()}
              disabled={loading || saving}
              className="border-line text-copy hover:bg-panel-hover w-full bg-transparent shadow-none transition-all hover:text-ink sm:w-auto"
            >
              <RefreshCw
                className={
                  isMobile
                    ? `h-4 w-4 ${loading ? 'animate-spin' : ''}`
                    : `mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`
                }
              />
              Refresh
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
      <div className="flex-1 overflow-auto p-4 md:p-6">
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

      {deleteProfile ? (
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
      ) : null}

      <LoginDialog
        open={Boolean(loginProfile)}
        profile={loginProfile}
        logs={wsLogs}
        onClose={() => setLoginProfileId(null)}
        onSuccess={refreshProfiles}
      />
    </div>
  )
}




