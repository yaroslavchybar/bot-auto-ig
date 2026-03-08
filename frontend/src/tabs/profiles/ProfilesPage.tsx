import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useProfiles } from '@/hooks/useProfiles'
import { DeleteConfirmation } from './DeleteConfirmation'
import { ProfileDetails } from './ProfileDetails'
import { ProfileForm } from './ProfileForm'
import { ProfileLogs } from './ProfileLogs'
import { ProfilesList } from './ProfilesList'
import { LoginDialog } from './LoginDialog'
import type { LogEntry, Profile } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIsMobile } from '@/hooks/use-mobile'
import { Plus, RefreshCw, Search, Terminal } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useWebSocket } from '@/hooks/useWebSocket'
import { AmbientGlow } from '@/components/ui/ambient-glow'

export function ProfilesPage() {
  const { profiles, loading: profilesLoading, refresh: refreshProfiles } = useProfiles()
  const isMobile = useIsMobile()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editProfile, setEditProfile] = useState<Profile | null>(null)

  // Local loading state for actions (save, delete, etc)
  const loading = profilesLoading
  const [saving, setSaving] = useState(false)

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isLogsOpen, setIsLogsOpen] = useState(false)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const { logs: wsLogs, clearLogs: clearWsLogs } = useWebSocket({
    enabled: isLoginOpen,
    pauseWhenHidden: true,
    maxBuffer: isMobile ? 250 : 500,
  })

  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) ?? null, [profiles, selectedId])
  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    if (!query) return profiles

    return profiles.filter((profile) => {
      const status = profile.using ? 'active' : profile.status ?? 'idle'
      const fields = [
        profile.name,
        profile.id,
        profile.proxy,
        profile.proxy_type,
        profile.fingerprint_os,
        status,
      ]

      return fields.some((field) => String(field ?? '').toLowerCase().includes(query))
    })
  }, [profiles, searchQuery])

  // On page mount, reconcile stale runtime status left after app/container restarts.
  useEffect(() => {
    let active = true

    const reconcileRuntimeState = async () => {
      try {
        await apiFetch<{ success: boolean; cleared?: number; errors?: string[] }>('/api/profiles/reconcile-runtime', { method: 'POST' })
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
  // Ensure we have a selection if possible
  useEffect(() => {
    if (!selectedId && profiles.length > 0) {
      setSelectedId(profiles[0].id)
    } else if (selectedId && !profiles.find(p => p.id === selectedId) && profiles.length > 0) {
      setSelectedId(profiles[0].id)
    }
  }, [profiles, selectedId])

  const loadLogs = useCallback(async (profileName?: string) => {
    setLogsLoading(true)
    setError(null)
    try {
      const data = await apiFetch<LogEntry[]>('/api/logs')
      const filtered = profileName ? data.filter((l) => String(l.message).includes(profileName)) : data
      setLogs(filtered.slice(-500))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLogsLoading(false)
    }
  }, [])


  useEffect(() => {
    if (isLogsOpen && selected?.name) {
      void loadLogs(selected.name)
    }
  }, [isLogsOpen, selected?.name, loadLogs])

  const handleCreate = () => {
    setEditProfile(null)
    setIsCreateOpen(true)
    setError(null)
  }

  const handleEdit = async (profile: Profile) => {
    setSelectedId(profile.id)
    setIsDetailsOpen(false)
    setSaving(true)
    setError(null)
    try {
      const fullProfile = await apiFetch<Profile>(`/api/profiles/by-id?profileId=${encodeURIComponent(profile.id)}`)
      setEditProfile(fullProfile)
      setIsEditOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteClick = (profile: Profile) => {
    setSelectedId(profile.id)
    setIsDetailsOpen(false)
    setShowDeleteDialog(true)
    setError(null)
  }

  const handleLogs = (profile: Profile) => {
    setSelectedId(profile.id)
    setIsDetailsOpen(false)
    setIsLogsOpen(true)
    setError(null)
  }

  const handleDetails = (profile?: Profile) => {
    if (profile) setSelectedId(profile.id)
    setIsDetailsOpen(true)
    setError(null)
  }

  const handleSelect = (profile: Profile) => {
    setSelectedId(profile.id)
    setError(null)
    // Optional: Auto open details on selection if desired, but maybe keep it explicit
  }

  const handleCloseDialogs = () => {
    setIsCreateOpen(false)
    setIsEditOpen(false)
    setEditProfile(null)
    setIsLogsOpen(false)
    setIsDetailsOpen(false)
    setShowDeleteDialog(false)
    setIsLoginOpen(false)
    setError(null)
  }

  const handleLogin = (profile: Profile) => {
    setSelectedId(profile.id)
    setIsDetailsOpen(false)
    clearWsLogs()
    setIsLoginOpen(true)
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
            proxy: typeof data.proxy === 'string' ? data.proxy.trim() : undefined,
            proxy_type: typeof data.proxy_type === 'string' ? data.proxy_type.trim() : undefined,
            fingerprint_seed: data.fingerprint_seed || undefined,
            fingerprint_os: data.fingerprint_os || undefined,
            cookies_json: typeof data.cookies_json === 'string' ? data.cookies_json.trim() : '',
            test_ip: Boolean(data.test_ip),
            daily_scraping_limit: typeof data.daily_scraping_limit === 'number' ? data.daily_scraping_limit : null,
          },
        })
        await refreshProfiles()
        setIsCreateOpen(false)
      } else if (isEditOpen && editProfile) {
        await apiFetch(`/api/profiles/${encodeURIComponent(editProfile.name)}`, {
          method: 'PUT',
          body: {
            name,
            proxy: typeof data.proxy === 'string' ? data.proxy.trim() : undefined,
            proxy_type: typeof data.proxy_type === 'string' ? data.proxy_type.trim() : undefined,
            fingerprint_seed: data.fingerprint_seed || undefined,
            fingerprint_os: data.fingerprint_os || undefined,
            cookies_json: typeof data.cookies_json === 'string' ? data.cookies_json.trim() : '',
            test_ip: Boolean(data.test_ip),
            daily_scraping_limit: typeof data.daily_scraping_limit === 'number' ? data.daily_scraping_limit : null,
          },
        })
        await refreshProfiles()
        setIsEditOpen(false)
        setEditProfile(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/api/profiles/${encodeURIComponent(selected.name)}`, { method: 'DELETE' })
      await refreshProfiles()
      setShowDeleteDialog(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleUsing = async (profile?: Profile) => {
    const target = profile || selected
    if (!target) return
    setSaving(true)
    setError(null)
    try {
      if (target.using) {
        try {
          await apiFetch(`/api/profiles/${encodeURIComponent(target.name)}/stop`, { method: 'POST' })
        } catch {
          // ignore
        }
      } else {
        await apiFetch(`/api/profiles/${encodeURIComponent(target.name)}/start`, { method: 'POST' })
      }
      await refreshProfiles()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#050505] text-gray-200 animate-in fade-in duration-300 relative">
      <AmbientGlow />
      {/* Header */}
      <div className="mobile-effect-blur mobile-effect-sticky border-b border-white/5 bg-white/[0.02] backdrop-blur-xs sticky top-0 z-10">
        <div className="flex flex-col gap-4 px-4 py-4 md:px-6 xl:flex-row xl:items-center xl:gap-6">
          <div className="relative w-full xl:max-w-xl xl:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search profiles..."
              className="h-11 rounded-xl border-white/10 bg-[#141414] pl-10 text-gray-100 placeholder:text-gray-500 focus-visible:ring-orange-500/60"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between xl:ml-auto xl:justify-end">
            <Button
              size={isMobile ? 'default' : 'sm'}
              onClick={handleCreate}
              disabled={loading || saving}
              className="mobile-effect-shadow w-full sm:w-auto border-none bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-orange-400 transition-all font-medium"
            >
              <Plus className={isMobile ? 'h-4 w-4' : 'mr-2 h-3.5 w-3.5'} />
              New Profile
            </Button>
            <Button
              variant="outline"
              size={isMobile ? 'default' : 'sm'}
              onClick={() => refreshProfiles()}
              disabled={loading || saving}
              className="w-full sm:w-auto shadow-none bg-transparent border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
            >
              <RefreshCw className={isMobile ? `h-4 w-4 ${loading ? 'animate-spin' : ''}` : `mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {error && !showDeleteDialog && !isCreateOpen && !isEditOpen && !isLogsOpen && !isDetailsOpen && (
        <div className="px-4 py-3 md:px-6 bg-red-500/10 text-red-400 text-sm border-b border-red-500/20 flex items-center shadow-[0_0_10px_rgba(239,68,68,0.2)]">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-2" />
          {error}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-[2000px] mx-auto space-y-4">
          <ProfilesList
            profiles={filteredProfiles}
            selectedId={selectedId}
            loading={loading}
            onSelect={handleSelect}
            onDetails={handleDetails}
            onEdit={handleEdit}
            onDelete={handleDeleteClick}
            onLogs={handleLogs}
            onToggleStatus={(p) => toggleUsing(p)}
            onLogin={handleLogin}
            emptyTitle={searchQuery.trim() ? 'No matching profiles' : 'No profiles'}
            emptyDescription={searchQuery.trim() ? 'Try a different search term or clear the filter.' : 'Create a new profile to get started.'}
          />
        </div>
      </div>

      {/* Dialogs & Sheets */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => {
        setIsCreateOpen(open)
        if (!open) setError(null)
      }}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] flex flex-col bg-[#0a0a0a] border-white/10 text-gray-200">
          <DialogHeader className="shrink-0">
            <DialogTitle className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Create Profile</DialogTitle>
          </DialogHeader>
          <ProfileForm
            mode="create"
            existingNames={profiles.map(p => p.name)}
            saving={saving}
            onSave={handleSaveProfile}
            onCancel={handleCloseDialogs}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={(open) => {
        setIsEditOpen(open)
        if (!open) setEditProfile(null)
      }}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] flex flex-col bg-[#0a0a0a] border-white/10 text-gray-200">
          <DialogHeader className="shrink-0">
            <DialogTitle className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Edit Profile</DialogTitle>
          </DialogHeader>
          {editProfile && (
            <ProfileForm
              mode="edit"
              initialData={editProfile}
              existingNames={profiles.map(p => p.name)}
              saving={saving}
              onSave={handleSaveProfile}
              onCancel={handleCloseDialogs}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isLogsOpen} onOpenChange={setIsLogsOpen}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0 overflow-hidden bg-[#0a0a0a] border-white/10 text-gray-200">
          <DialogHeader className="p-6 pb-2 border-b border-white/5">
            <DialogTitle className="flex items-center gap-2 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              <Terminal className="h-5 w-5 text-gray-300" />
              Logs: <span className="font-mono text-gray-400">{selected?.name}</span>
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <ProfileLogs
              logs={logs}
              loading={logsLoading}
              onRefresh={() => loadLogs(selected.name)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <SheetContent className="w-full max-w-full sm:w-[540px] p-0 flex flex-col gap-0 border-l border-white/10 shadow-xl bg-[#0a0a0a] text-gray-200">
          <SheetHeader className="p-6 pb-4 border-b border-white/5 bg-white/[0.02]">
            <SheetTitle className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Profile Details</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <ProfileDetails
                profile={selected}
              />
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">Select a profile first</div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {selected && (
        <DeleteConfirmation
          open={showDeleteDialog}
          profileName={selected.name}
          saving={saving}
          error={error}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}

      <LoginDialog
        open={isLoginOpen}
        profile={selected}
        logs={wsLogs}
        onClose={() => setIsLoginOpen(false)}
        onSuccess={refreshProfiles}
      />
    </div>
  )
}
