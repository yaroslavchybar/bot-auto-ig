import { Plus, RefreshCw, Search, Terminal } from 'lucide-react'
import type { LogEntry } from '@/lib/logs'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { ProfileDetails } from '../components/ProfileDetails'
import { ProfileForm } from '../components/ProfileForm'
import { ProfileLogs } from '../components/ProfileLogs'
import { ProfilesList } from '../components/ProfilesList'
import { LoginDialog } from '../components/LoginDialog'
import type { Profile } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useProfilesPage } from '../hooks/useProfilesPage'

export function ProfilesPageContainer() {
  const s = useProfilesPage()
  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />
      <ProfilesHeader searchQuery={s.searchQuery} onSearchChange={s.setSearchQuery}
        onRefresh={() => void s.handleRefreshProfiles()} onCreate={s.handleCreate}
        loading={s.loading} saving={s.saving} refreshing={s.refreshing} />
      <ProfilesErrorBanner s={s} />
      <ProfilesContent s={s} />
      <ProfileFormDialogs profiles={s.profiles} isCreateOpen={s.isCreateOpen}
        editProfile={s.editProfile} saving={s.saving}
        onCreateOpenChange={(open) => { s.setIsCreateOpen(open); if (!open) s.handleCloseCreate() }}
        onCloseEdit={s.handleCloseEdit} onSaveProfile={s.handleSaveProfile}
        onCloseCreate={s.handleCloseCreate} />
      <ProfileViewDialogs logsProfile={s.logsProfile} detailsProfile={s.detailsProfile}
        deleteProfile={s.deleteProfile} loginProfile={s.loginProfile} saving={s.saving}
        error={s.error} logs={s.logs} logsLoading={s.logsLoading} wsLogs={s.wsLogs}
        onSetLogsProfileId={s.setLogsProfileId} onSetDetailsProfileId={s.setDetailsProfileId}
        onSetLoginProfileId={s.setLoginProfileId} onDeleteConfirm={s.handleDeleteConfirm}
        onRefreshProfiles={s.refreshProfiles} onLoadLogs={s.loadLogs} />
    </div>
  )
}

function ProfilesErrorBanner({ s }: { s: ReturnType<typeof useProfilesPage> }) {
  if (!s.error || s.deleteProfile || s.isCreateOpen || s.editProfile || s.logsProfile || s.detailsProfile) return null
  return (
    <div className="status-banner-danger flex items-center border-b px-4 py-3 text-sm md:px-6">
      <span className="status-dot-danger mr-2 h-1.5 w-1.5 rounded-full" />{s.error}
    </div>
  )
}

function ProfilesContent({ s }: { s: ReturnType<typeof useProfilesPage> }) {
  return (
    <div className="flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
      <div className="mx-auto max-w-[2000px] space-y-4">
        <ProfilesList profiles={s.filteredProfiles} loading={s.loading}
          onDetails={s.handleDetails} onEdit={s.handleEdit} onDelete={s.handleDeleteClick}
          onLogs={s.handleLogs} onToggleStatus={(p) => s.toggleUsing(p)} onLogin={s.handleLogin}
          emptyTitle={s.searchQuery.trim() ? 'No matching profiles' : 'No profiles'}
          emptyDescription={s.searchQuery.trim()
            ? 'Try a different search term or clear the filter.'
            : 'Create a new profile to get started.'} />
      </div>
    </div>
  )
}

/* ── Header sub-component ── */

function ProfilesHeader({
  searchQuery,
  onSearchChange,
  onRefresh,
  onCreate,
  loading,
  saving,
  refreshing,
}: {
  searchQuery: string
  onSearchChange: (value: string) => void
  onRefresh: () => void
  onCreate: () => void
  loading: boolean
  saving: boolean
  refreshing: boolean
}) {
  return (
    <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        <div className="flex flex-grow items-center gap-2">
          <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
            <Input
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search..."
              className="bg-field border border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pl-9 text-sm font-normal leading-5 shadow-sm"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={loading || saving || refreshing}
            aria-label="Refresh profiles"
            title="Refresh profiles"
            className="h-8 w-8 shrink-0 p-0"
          >
            <RefreshCw
              className={
                loading || refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'
              }
            />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
          <Button
            size="icon"
            onClick={onCreate}
            disabled={loading || saving}
            className="mobile-effect-shadow brand-button h-8 w-auto px-3.5 text-sm"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Profile
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Form Dialogs (Create + Edit) ── */

function ProfileFormDialogs({
  profiles,
  isCreateOpen,
  editProfile,
  saving,
  onCreateOpenChange,
  onCloseEdit,
  onSaveProfile,
  onCloseCreate,
}: {
  profiles: Profile[]
  isCreateOpen: boolean
  editProfile: Profile | null
  saving: boolean
  onCreateOpenChange: (open: boolean) => void
  onCloseEdit: () => void
  onSaveProfile: (data: Partial<Profile>) => void
  onCloseCreate: () => void
}) {
  return (
    <>
      <Dialog open={isCreateOpen} onOpenChange={onCreateOpenChange}>
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
            onSave={onSaveProfile}
            onCancel={onCloseCreate}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editProfile)}
        onOpenChange={(open) => { if (!open) onCloseEdit() }}
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
              onSave={onSaveProfile}
              onCancel={onCloseEdit}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ── Logs Dialog ── */

function ProfileLogsDialog({
  logsProfile, logs, logsLoading, onClose, onLoadLogs,
}: {
  logsProfile: Profile | null; logs: LogEntry[]; logsLoading: boolean
  onClose: () => void; onLoadLogs: (profileName?: string) => Promise<void>
}) {
  return (
    <Dialog open={Boolean(logsProfile)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="bg-panel border-line text-ink flex h-[80vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-line-soft border-b p-6 pb-2">
          <DialogTitle className="page-title-gradient flex items-center gap-2">
            <Terminal className="text-copy h-5 w-5" />
            Logs: <span className="text-muted-copy font-mono">{logsProfile?.name}</span>
          </DialogTitle>
        </DialogHeader>
        {logsProfile && (
          <ProfileLogs logs={logs} loading={logsLoading} onRefresh={() => onLoadLogs(logsProfile.name)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Details Sheet ── */

function ProfileDetailsSheet({
  detailsProfile, onClose,
}: { detailsProfile: Profile | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(detailsProfile)} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="border-line bg-panel text-ink flex w-full max-w-full flex-col gap-0 border-l p-0 shadow-xl sm:w-[540px]">
        <SheetHeader className="border-line-soft bg-panel-subtle border-b p-6 pb-4">
          <SheetTitle className="page-title-gradient">Profile Details</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {detailsProfile ? (
            <ProfileDetails profile={detailsProfile} />
          ) : (
            <div className="text-muted-foreground p-8 text-center text-sm">Profile unavailable.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ── View Dialogs (composed) ── */

interface ProfileViewDialogsProps {
  logsProfile: Profile | null; detailsProfile: Profile | null
  deleteProfile: Profile | null; loginProfile: Profile | null
  saving: boolean; error: string | null
  logs: LogEntry[]; logsLoading: boolean; wsLogs: LogEntry[]
  onSetLogsProfileId: (id: string | null) => void
  onSetDetailsProfileId: (id: string | null) => void
  onSetLoginProfileId: (id: string | null) => void
  onDeleteConfirm: () => void
  onRefreshProfiles: () => Promise<void>
  onLoadLogs: (profileName?: string) => Promise<void>
}

function ProfileViewDialogsInner(p: ProfileViewDialogsProps) {
  return (
    <>
      <ProfileLogsDialog logsProfile={p.logsProfile} logs={p.logs} logsLoading={p.logsLoading}
        onClose={() => p.onSetLogsProfileId(null)} onLoadLogs={p.onLoadLogs} />
      <ProfileDetailsSheet detailsProfile={p.detailsProfile}
        onClose={() => p.onSetDetailsProfileId(null)} />
    </>
  )
}

function ProfileViewDeleteAndLogin(p: ProfileViewDialogsProps) {
  return (
    <>
      {p.deleteProfile ? (
        <ConfirmDeleteDialog open={Boolean(p.deleteProfile)} title="Delete Profile?"
          entityLabel="and its data" itemName={p.deleteProfile.name} confirmLabel="Delete Profile"
          saving={p.saving} error={p.error} onConfirm={p.onDeleteConfirm}
          onCancel={() => p.onSetDetailsProfileId(null)} />
      ) : null}
      <LoginDialog key={p.loginProfile?.id ?? 'no-login'} open={Boolean(p.loginProfile)}
        profile={p.loginProfile} logs={p.wsLogs}
        onClose={() => p.onSetLoginProfileId(null)} onSuccess={p.onRefreshProfiles} />
    </>
  )
}

function ProfileViewDialogs(p: ProfileViewDialogsProps) {
  return (
    <>
      <ProfileViewDialogsInner {...p} />
      <ProfileViewDeleteAndLogin {...p} />
    </>
  )
}
