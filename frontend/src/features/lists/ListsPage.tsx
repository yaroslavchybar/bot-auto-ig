import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { ModelCreateForm } from './components/ModelCreateForm'
import { ListsList } from './components/ListsList'
import { ModelContentPanel } from './components/ModelContentPanel'
import { ModelIdentityPanel } from './components/ModelIdentityPanel'
import { ModelProfilesPanel } from './components/ModelProfilesPanel'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useListsPage } from './hooks/useListsPage'
import { useState } from 'react'

export function ListsPage() {
  const state = useListsPage()
  const [contentModelId, setContentModelId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'content' | 'names' | 'profiles'>('content')
  const [contentRefreshKey, setContentRefreshKey] = useState(0)
  const contentModel = state.lists.find((model) => model.id === contentModelId)

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <ListsHeader loading={state.loading} saving={state.saving}
        onCreate={state.handleCreate} />

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px]">
          <ListsList lists={state.lists} loading={state.loading}
            refreshKey={contentRefreshKey} onOpenContent={(model) => {
              setContentModelId(model.id)
              setDetailTab('content')
            }}
            onEdit={(model) => {
              setContentModelId(model.id)
              setDetailTab('names')
            }} onDelete={state.handleDeleteClick} />
        </div>
      </div>

      <ListsDialogs state={state} />
      <Dialog open={Boolean(contentModel)} onOpenChange={(open) => { if (!open) setContentModelId(null) }}>
        <DialogContent className="bg-panel border-line text-ink flex h-[min(90vh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[860px]">
          <DialogHeader className="shrink-0 p-5 pr-10 pb-0 sm:px-6">
            <DialogTitle className="page-title-gradient">{contentModel?.name}</DialogTitle>
          </DialogHeader>
          <div role="tablist" aria-label="Model details" className="border-line-soft flex shrink-0 gap-1 overflow-x-auto border-b px-5 pt-3 sm:px-6">
            {([
              { id: 'content', label: 'Content bank' },
              { id: 'names', label: 'Usernames & full names' },
              { id: 'profiles', label: 'Profiles' },
            ] as const).map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={detailTab === tab.id}
                onClick={() => setDetailTab(tab.id)}
                className={`shrink-0 px-3 py-2 text-sm font-medium transition-colors ${detailTab === tab.id
                  ? 'border-b-2 border-ink text-ink' : 'text-subtle-copy hover:text-ink'}`}>
                {tab.label}
              </button>
            ))}
          </div>
          {contentModel && (
            <>
              <div role="tabpanel" hidden={detailTab !== 'content'} className="min-h-0 flex-1 overflow-hidden">
                <ModelContentPanel key={contentModel.id} model={contentModel}
                  onUploaded={() => setContentRefreshKey((key) => key + 1)} />
              </div>
              <div role="tabpanel" hidden={detailTab !== 'names'} className="min-h-0 flex-1 overflow-hidden">
                <ModelIdentityPanel key={contentModel.id} model={contentModel} />
              </div>
              {detailTab === 'profiles' && (
                <div role="tabpanel" className="min-h-0 flex-1 overflow-hidden">
                  <ModelProfilesPanel model={contentModel} />
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ListsHeader({ loading, saving, onCreate }: {
  loading: boolean; saving: boolean
  onCreate: () => void
}) {
  return (
    <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={onCreate} disabled={loading || saving}
            className="mobile-effect-shadow brand-button h-8 font-medium">
            <Plus className="mr-2 h-3.5 w-3.5" /> Create Model
          </Button>
        </div>
      </div>
    </div>
  )
}

function ListsDialogs({ state }: { state: ReturnType<typeof useListsPage> }) {
  return (
    <>
      <Dialog open={state.isCreateOpen} onOpenChange={state.setIsCreateOpen}>
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[800px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Create Model</DialogTitle>
          </DialogHeader>
          <ModelCreateForm key={state.isCreateOpen ? 'create-open' : 'create-closed'}
            saving={state.saving} onSave={state.handleSave}
            onCancel={state.handleCloseCreate} />
        </DialogContent>
      </Dialog>

      {state.deleteListTarget ? (
        <ConfirmDeleteDialog open={Boolean(state.deleteListTarget)}
          title="Delete Model?" entityLabel="" itemName={state.deleteListTarget.name}
          confirmLabel="Delete Model" saving={state.saving} error={null}
          onConfirm={state.handleDelete} onCancel={() => state.setDeleteListTargetId(null)} />
      ) : null}
    </>
  )
}
