import { createPortal } from 'react-dom'
import { TableCard } from '@/components/shared/TablePagination'
import { useHeaderToolbarSlot } from '@/components/layout/useHeaderSlot'
import { Plus, Search } from 'lucide-react'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { ProfileForm } from './components/ProfileForm'
import { BatchCreateForm } from './components/BatchCreateForm'
import { ProfilesList } from './components/ProfilesList'
import type { Profile } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useProfilesPage } from './hooks/useProfilesPage'

export function ProfilesPage() {
  const s = useProfilesPage()
  // Desktop: search and New Profile move into the app header. Mobile: they stay above the table.
  const headerSlot = useHeaderToolbarSlot('profiles-header-slot', 360)
  return (
    <div className="relative flex h-full flex-col bg-shell text-ink">
      {headerSlot ? createPortal(<ProfilesToolbar s={s} />, headerSlot) : null}
      <ProfilesContent s={s} toolbarInHeader={Boolean(headerSlot)} />
      <ProfileFormDialogs
        isCreateOpen={s.isCreateOpen}
        editProfile={s.editProfile}
        saving={s.saving}
        refreshProfiles={s.refreshProfiles}
        onCreateOpenChange={(open) => {
          s.setIsCreateOpen(open)
          if (!open) s.handleCloseCreate()
        }}
        onCloseEdit={s.handleCloseEdit}
        onSaveProfile={s.handleSaveProfile}
        onCloseCreate={s.handleCloseCreate}
      />
      <ProfileViewDialogs
        deleteProfile={s.deleteProfile}
        saving={s.saving}
        onSetDeleteProfileId={s.setDeleteProfileId}
        onDeleteConfirm={s.handleDeleteConfirm}
      />
    </div>
  )
}

function ProfilesContent({
  s,
  toolbarInHeader,
}: {
  s: ReturnType<typeof useProfilesPage>
  toolbarInHeader: boolean
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!toolbarInHeader && (
        <div className="px-4 pt-3 pb-3">
          <ProfilesToolbar s={s} />
        </div>
      )}
      <TableCard
        pagination={{ ...s.pagination, pageSize: s.pageSize, onPageSizeChange: s.setPageSize }}
      >
        <ProfilesList
          profiles={s.filteredProfiles}
          loading={s.loading}
          onEdit={s.handleEdit}
          onDelete={s.handleDeleteClick}
          onToggleStatus={(p) => s.toggleUsing(p)}
          emptyTitle={s.searchQuery.trim() ? 'No matching profiles' : 'No profiles'}
          emptyDescription={
            s.searchQuery.trim()
              ? 'Try a different search term or clear the filter.'
              : 'Create a new profile to get started.'
          }
        />
      </TableCard>
    </div>
  )
}

/* ── Search + New Profile (header on desktop, above table on mobile) ── */

type ProfilesState = ReturnType<typeof useProfilesPage>

function ProfilesToolbar({ s }: { s: ProfilesState }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-[280px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
        <Input
          value={s.searchQuery}
          onChange={(event) => s.setSearchQuery(event.target.value)}
          placeholder="Search..."
          className="h-8 rounded-md border brand-focus border-line bg-field pl-9 text-sm leading-5 font-normal text-copy shadow-sm placeholder:text-muted-copy"
        />
      </div>
      <Button
        size="icon"
        onClick={s.handleCreate}
        disabled={s.loading || s.saving}
        className="h-8 w-auto shrink-0 brand-button px-3.5 text-sm"
      >
        <Plus className="mr-2 h-4 w-4" />
        New Profile
      </Button>
    </div>
  )
}

/* ── Form Dialogs (Create + Edit) ── */

function ProfileFormDialogs({
  isCreateOpen,
  editProfile,
  saving,
  refreshProfiles,
  onCreateOpenChange,
  onCloseEdit,
  onSaveProfile,
  onCloseCreate,
}: {
  isCreateOpen: boolean
  editProfile: Profile | null
  saving: boolean
  refreshProfiles: () => Promise<void>
  onCreateOpenChange: (open: boolean) => void
  onCloseEdit: () => void
  onSaveProfile: (data: Partial<Profile>) => void
  onCloseCreate: () => void
}) {
  return (
    <>
      <Dialog open={isCreateOpen} onOpenChange={onCreateOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Create Profile</DialogTitle>
          </DialogHeader>
          <BatchCreateForm
            key={isCreateOpen ? 'profile-create-open' : 'profile-create-closed'}
            onCreated={async () => {
              await refreshProfiles()
              onCloseCreate()
            }}
            onCancel={onCloseCreate}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editProfile)}
        onOpenChange={(open) => {
          if (!open) onCloseEdit()
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Edit Profile</DialogTitle>
          </DialogHeader>
          {editProfile && (
            <ProfileForm
              key={editProfile.id}
              initialData={editProfile}
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

/* ── View Dialogs (composed) ── */

interface ProfileViewDialogsProps {
  deleteProfile: Profile | null
  saving: boolean
  onSetDeleteProfileId: (id: string | null) => void
  onDeleteConfirm: () => void
}

function ProfileViewDialogs(p: ProfileViewDialogsProps) {
  return (
    <>
      {p.deleteProfile ? (
        <ConfirmDeleteDialog
          open={Boolean(p.deleteProfile)}
          title="Delete Profile?"
          entityLabel="and its data"
          itemName={p.deleteProfile.name}
          confirmLabel="Delete Profile"
          saving={p.saving}
          error={null}
          onConfirm={p.onDeleteConfirm}
          onCancel={() => p.onSetDeleteProfileId(null)}
        />
      ) : null}
    </>
  )
}
