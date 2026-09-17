import { Plus, Search } from 'lucide-react'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ProxiesForm } from './components/ProxiesForm'
import { ProxiesList } from './components/ProxiesList'
import { useProxiesPage } from './hooks/useProxiesPage'

export function ProxiesPage() {
  const state = useProxiesPage()

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
          <div className="flex flex-grow items-center gap-2">
            <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
              <Input
                value={state.searchQuery}
                onChange={(event) => state.setSearchQuery(event.target.value)}
                placeholder="Search..."
                className="bg-field border border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pl-9 text-sm font-normal leading-5 shadow-sm"
              />
            </div>
          </div>
          <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
            <Button
              size="sm"
              onClick={state.handleCreate}
              disabled={state.loading || state.saving}
              className="mobile-effect-shadow brand-button h-8 font-medium"
            >
              <Plus className="mr-2 h-3.5 w-3.5" /> Add Proxy
            </Button>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px]">
          <ProxiesList
            proxies={state.proxies}
            usage={state.usage}
            loading={state.loading}
            onEdit={state.handleEdit}
            onDelete={state.handleDeleteClick}
          />
        </div>
      </div>

      <Dialog open={state.isCreateOpen} onOpenChange={state.setIsCreateOpen}>
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Add Proxy</DialogTitle>
          </DialogHeader>
          <ProxiesForm
            key={state.isCreateOpen ? 'create-open' : 'create-closed'}
            mode="create"
            existingNames={state.allProxies.map((p) => p.name)}
            saving={state.saving}
            onSave={(values) => void state.handleSave(values)}
            onCancel={state.handleCloseCreate}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(state.editProxy)}
        onOpenChange={(open) => {
          if (!open) state.handleCloseEdit()
        }}
      >
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Edit Proxy</DialogTitle>
          </DialogHeader>
          {state.editProxy ? (
            <ProxiesForm
              key={state.editProxy.id}
              mode="edit"
              initialData={state.editProxy}
              existingNames={state.allProxies.map((p) => p.name)}
              saving={state.saving}
              onSave={(values) => void state.handleSave(values)}
              onCancel={state.handleCloseEdit}
            />
          ) : (
            <div className="text-subtle-copy p-4 text-sm">Proxy unavailable.</div>
          )}
        </DialogContent>
      </Dialog>

      {state.deleteTarget ? (
        <ConfirmDeleteDialog
          open={Boolean(state.deleteTarget)}
          title="Delete Proxy?"
          entityLabel=""
          itemName={state.deleteTarget.name}
          confirmLabel="Delete Proxy"
          saving={state.saving}
          error={null}
          onConfirm={() => void state.handleDelete()}
          onCancel={() => state.setDeleteProxyId(null)}
        />
      ) : null}
    </div>
  )
}
