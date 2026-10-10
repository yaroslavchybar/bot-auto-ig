import { createPortal } from 'react-dom'
import { TableCard } from '@/components/shared/TablePagination'
import { useHeaderToolbarSlot } from '@/components/layout/useHeaderSlot'
import { CheckCircle2, CircleAlert, Plus, Search, Upload } from 'lucide-react'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProxiesForm } from './components/ProxiesForm'
import { CountrySelect } from './components/CountrySelect'
import { ProxiesList } from './components/ProxiesList'
import { useProxiesPage } from './hooks/useProxiesPage'
import { useMutation } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useState } from 'react'
import { useLocation, useNavigate } from '@/lib/router'
import { cn } from '@/lib/utils'
import { PROXY_TABS, parseProxyTab, type ProxyTabId } from './proxyTabs'
import { ProxyBlacklist } from './components/ProxyBlacklist'

export function ProxiesPage() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const tab = parseProxyTab(new URLSearchParams(search).get('tab'))
  const setTab = (next: ProxyTabId) => {
    if (next !== tab) navigate(`/proxies?tab=${next}`)
  }
  const state = useProxiesPage(tab === 'proxies')
  // Desktop: toolbar controls share the app header. Mobile: they stay above the table.
  const headerSlot = useHeaderToolbarSlot('proxies-header-slot', 480)
  const toolbarInHeader = Boolean(headerSlot)
  const importMany = useMutation(api.proxies.importMany)
  const [importing, setImporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importType, setImportType] = useState<'http' | 'socks5'>('http')
  const [importPurpose, setImportPurpose] = useState<'work' | 'login'>('work')
  const [importCountry, setImportCountry] = useState('')
  const [importNotice, setImportNotice] = useState('')
  const [importError, setImportError] = useState('')

  function openImport() {
    setImportFile(null)
    setImportError('')
    setImportOpen(true)
  }

  async function handleImport() {
    if (!importFile || !importCountry || importing) {
      setImportError('Choose a TXT file and country')
      return
    }
    setImporting(true)
    setImportNotice('')
    setImportError('')
    try {
      const result = await importMany({
        text: await importFile.text(),
        proxyType: importType,
        purpose: importPurpose,
        country: importCountry,
      })
      setImportNotice(`Imported ${result.imported} proxies; skipped ${result.skipped}.`)
      setImportOpen(false)
      setImportFile(null)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }

  const controls = (
    <>
      <div className="relative min-w-40 flex-1 sm:w-[280px] sm:flex-initial">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
        <Input
          value={state.searchQuery}
          onChange={(event) => state.setSearchQuery(event.target.value)}
          aria-label="Search proxies"
          placeholder="Search..."
          className="h-8 rounded-md border brand-focus border-line bg-field pl-9 text-sm leading-5 font-normal text-copy shadow-sm placeholder:text-muted-copy"
        />
      </div>
      <ProxyActions
        importing={importing}
        addDisabled={state.loading || state.saving}
        onImport={openImport}
        onAdd={state.handleCreate}
      />
    </>
  )

  return (
    <div className="relative flex h-full flex-col bg-shell text-ink">
      {tab === 'proxies' && toolbarInHeader && headerSlot
        ? createPortal(
            <div className="flex min-w-0 flex-1 items-center justify-end gap-3">{controls}</div>,
            headerSlot,
          )
        : null}
      <div
        className={cn(
          'relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3',
          (toolbarInHeader || tab !== 'proxies') && 'md:hidden',
        )}
      >
        <div className="mb-2 flex items-center gap-1 rounded-full button-toolbar-group p-1 md:hidden">
          {PROXY_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={item.id === tab ? 'page' : undefined}
              className={cn(
                'h-7 flex-1 rounded-full px-2 text-xs font-medium whitespace-nowrap',
                item.id === tab ? 'bg-panel-muted text-ink shadow-xs' : 'text-muted-copy',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === 'proxies' && !toolbarInHeader && (
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            {controls}
          </div>
        )}
      </div>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!importing) {
            setImportOpen(open)
            if (!open) setImportFile(null)
          }
        }}
      >
        <DialogContent className="border-line bg-panel text-ink sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="page-title-gradient">Import proxies</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid gap-1.5">
              <Label htmlFor="proxy-import-file">TXT file</Label>
              <Input
                id="proxy-import-file"
                type="file"
                accept=".txt,text/plain"
                disabled={importing}
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] ?? null)
                  setImportError('')
                }}
              />
              <p className="text-xs text-subtle-copy">
                One host:port:user:pass or host:port per line.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="proxy-import-type">Type</Label>
              <Select
                value={importType}
                onValueChange={(v) => setImportType(v as 'http' | 'socks5')}
                disabled={importing}
              >
                <SelectTrigger id="proxy-import-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="panel-dropdown">
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="proxy-import-purpose">Use for</Label>
              <Select
                value={importPurpose}
                onValueChange={(v) => setImportPurpose(v as 'work' | 'login')}
                disabled={importing}
              >
                <SelectTrigger id="proxy-import-purpose">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="panel-dropdown">
                  <SelectItem value="work">Work</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <CountrySelect value={importCountry} onChange={setImportCountry} disabled={importing} />
            {importError && (
              <p role="alert" className="text-sm text-status-danger">
                {importError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setImportOpen(false)
                setImportFile(null)
              }}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleImport()}
              disabled={importing || !importFile || !importCountry}
            >
              {importing ? 'Importing...' : 'Import proxies'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {tab === 'proxies' && (importNotice || importError) && (
        <div className="relative z-10 flex-none px-4 md:px-6">
          <div className="mx-auto max-w-[2000px] pb-2">
            {importNotice && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-xl border border-status-success-border bg-status-success-soft px-4 py-2.5 text-sm text-status-success"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 break-words">{importNotice}</span>
              </div>
            )}
            {importError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-status-danger-border bg-status-danger-soft px-4 py-2.5 text-sm text-status-danger"
              >
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 break-words">{importError}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          'relative z-10 flex min-h-0 flex-1 flex-col px-4 md:px-6',
          tab === 'proxies' ? '' : 'overflow-auto pb-4 md:pb-6',
        )}
      >
        {tab === 'proxies' ? (
          <div className="-mx-4 flex min-h-0 flex-1 flex-col md:-mx-6">
            <TableCard
              pagination={{
                ...state.pagination,
                pageSize: state.pageSize,
                onPageSizeChange: state.setPageSize,
              }}
            >
              <ProxiesList
                proxies={state.proxies}
                usage={state.usage}
                loading={state.loading}
                onEdit={state.handleEdit}
                onDelete={state.handleDeleteClick}
              />
            </TableCard>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[2000px]">
            <ProxyBlacklist />
          </div>
        )}
      </div>

      <Dialog open={state.isCreateOpen} onOpenChange={state.setIsCreateOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border-line bg-panel text-ink sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Add Proxy</DialogTitle>
          </DialogHeader>
          <ProxiesForm
            key={state.isCreateOpen ? 'create-open' : 'create-closed'}
            mode="create"
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
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border-line bg-panel text-ink sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Edit Proxy</DialogTitle>
          </DialogHeader>
          {state.editProxy ? (
            <ProxiesForm
              key={state.editProxy.id}
              mode="edit"
              initialData={state.editProxy}
              saving={state.saving}
              onSave={(values) => void state.handleSave(values)}
              onCancel={state.handleCloseEdit}
            />
          ) : (
            <div className="p-4 text-sm text-subtle-copy">Proxy unavailable.</div>
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

/* Import and Add buttons. Shown in the app header on desktop and above the table on mobile. */
function ProxyActions({
  className,
  importing,
  addDisabled,
  onImport,
  onAdd,
}: {
  className?: string
  importing: boolean
  addDisabled: boolean
  onImport: () => void
  onAdd: () => void
}) {
  return (
    <div className={cn('flex shrink-0 gap-2', className)}>
      <Button
        variant="outline"
        disabled={importing}
        className="button-panel font-medium"
        onClick={onImport}
      >
        <Upload className="h-3.5 w-3.5" /> Import TXT
      </Button>
      <Button onClick={onAdd} disabled={addDisabled} className="brand-button font-medium">
        <Plus className="mr-2 h-3.5 w-3.5" /> Add Proxy
      </Button>
    </div>
  )
}
