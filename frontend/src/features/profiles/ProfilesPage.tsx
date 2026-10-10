import { TableCard } from '@/components/shared/TablePagination'
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
  return (
    <div className="relative flex h-full flex-col bg-shell text-ink">
      <ProfilesHeader
        searchQuery={s.searchQuery}
        onSearchChange={s.setSearchQuery}
        onCreate={s.handleCreate}
        loading={s.loading}
        saving={s.saving}
      />
      <ProfilesContent s={s} />
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

function ProfilesContent({ s }: { s: ReturnType<typeof useProfilesPage> }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-0 pb-4 md:px-6 md:pb-6">
      <div className="mx-auto flex min-h-0 w-full max-w-[2000px] flex-1 flex-col">
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
    </div>
  )
}

/* ── Header sub-component ── */

function ProfilesHeader({
  searchQuery,
  onSearchChange,
  onCreate,
  loading,
  saving,
}: {
  searchQuery: string
  onSearchChange: (value: string) => void
  onCreate: () => void
  loading: boolean
  saving: boolean
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
              className="h-8 rounded-md border brand-focus border-line bg-field pl-9 text-sm leading-5 font-normal text-copy shadow-sm placeholder:text-muted-copy"
            />
          </div>
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
          <Button
            size="icon"
            onClick={onCreate}
            disabled={loading || saving}
            className="h-8 w-auto brand-button px-3.5 text-sm"
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
