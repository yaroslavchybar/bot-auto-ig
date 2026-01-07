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
import { Plus, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useWebSocket } from '@/hooks/useWebSocket'

export function ProfilesPage() {
  const { profiles, loading: profilesLoading, refresh: refreshProfiles } = useProfiles()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Local loading state for actions (save, delete, etc)
  // We rename the hook's loading to profilesLoading to distinguish it
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

  const { logs: wsLogs, clearLogs: clearWsLogs } = useWebSocket()

  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) ?? null, [profiles, selectedId])

  // Ensure we have a selection if possible
  useEffect(() => {
    if (!selectedId && profiles.length > 0) {
      setSelectedId(profiles[0].id)
    } else if (selectedId && !profiles.find(p => p.id === selectedId) && profiles.length > 0) {
      // If selected ID is gone, select first
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
    setIsCreateOpen(true)
    setError(null)
  }

  const handleEdit = (profile: Profile) => {
    setSelectedId(profile.id)
    setIsDetailsOpen(false)
    setIsEditOpen(true)
    setError(null)
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
  }

  const handleCloseDialogs = () => {
    setIsCreateOpen(false)
    setIsEditOpen(false)
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
            proxy: String(data.proxy ?? '').trim() || undefined,
            proxy_type: String(data.proxy_type ?? '').trim() || undefined,
            fingerprint_seed: data.fingerprint_seed || undefined,
            fingerprint_os: data.fingerprint_os || undefined,
            test_ip: Boolean(data.test_ip),
          },
        })
        await refreshProfiles()
        setIsCreateOpen(false)
      } else if (isEditOpen && selected) {
        await apiFetch(`/api/profiles/${encodeURIComponent(selected.name)}`, {
          method: 'PUT',
          body: {
            name,
            proxy: String(data.proxy ?? '').trim() || undefined,
            proxy_type: String(data.proxy_type ?? '').trim() || undefined,
            fingerprint_seed: data.fingerprint_seed || undefined,
            fingerprint_os: data.fingerprint_os || undefined,
            test_ip: Boolean(data.test_ip),
          },
        })
        await refreshProfiles()
        setIsEditOpen(false)
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
        // Stop the browser - ignore errors as browser may have already stopped
        try {
          await apiFetch(`/api/profiles/${encodeURIComponent(target.name)}/stop`, { method: 'POST' })
        } catch {
          // Browser may have already stopped externally - just refresh state
        }
      } else {
        // Start the browser
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
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-2xl font-bold tracking-tight">Profiles Manager</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refreshProfiles()} disabled={loading || saving}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button size="sm" onClick={handleCreate} disabled={loading || saving}>
            <Plus className="mr-2 h-4 w-4" />
            Create
          </Button>
        </div>
      </div>

      {error && !showDeleteDialog && !isCreateOpen && !isEditOpen && !isLogsOpen && !isDetailsOpen && (
        <div className="p-4 bg-destructive/10 text-destructive text-sm border-b border-destructive/20">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 bg-muted/10">
        <ProfilesList
          profiles={profiles}
          selectedId={selectedId}
          loading={loading}
          onSelect={handleSelect}
          onDetails={handleDetails}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
          onLogs={handleLogs}
          onToggleStatus={(p) => toggleUsing(p)}
          onLogin={handleLogin}
        />
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Profile</DialogTitle>
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

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
          </DialogHeader>
          {selected && (
            <ProfileForm
              mode="edit"
              initialData={selected}
              existingNames={profiles.map(p => p.name)}
              saving={saving}
              onSave={handleSaveProfile}
              onCancel={handleCloseDialogs}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isLogsOpen} onOpenChange={setIsLogsOpen}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Activity Logs: {selected?.name}</DialogTitle>
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

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Profile details</DialogTitle>
          </DialogHeader>
          {selected ? (
            <ProfileDetails
              profile={selected}
            />
          ) : (
            <div className="text-sm text-muted-foreground">Select a profile first</div>
          )}
        </DialogContent>
      </Dialog>

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
