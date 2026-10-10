import { createPortal } from 'react-dom'
import { TablePagination, TableCard } from '@/components/shared/TablePagination'
import { useHeaderToolbarSlot } from '@/components/layout/useHeaderSlot'
import { useAccountsPage } from './hooks/useAccountsPage'
import { useState } from 'react'
import { CheckCircle2, CircleAlert, Plus, Search, Upload } from 'lucide-react'
import { apiFetch } from '@/lib/api'
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
import { Textarea } from '@/components/ui/textarea'
import { useNavigate, useSearchParams } from '@/lib/router'
import { AccountsList, type Account } from './components/AccountsList'
import { AccountDetailsDialog } from './components/AccountDetailsDialog'

export function IgAccountsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const profileId = searchParams.get('profileId')

  const [search, setSearch] = useState('')
  const [credentialSearch, setCredentialSearch] = useState('')
  const [selectedLabel, setSelectedLabel] = useState('')
  const {
    accounts: filteredAccounts,
    loading,
    error: loadError,
    refresh,
    pagination,
    pageSize,
    setPageSize,
  } = useAccountsPage(search)
  const options = useAccountsPage(credentialSearch, profileId ?? undefined, Boolean(profileId))
  const connectable = options.accounts.filter((account) => account.status === 'available')
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [detailsAccount, setDetailsAccount] = useState<Account | null>(null)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)

  const [text, setText] = useState('')
  const [selected, setSelected] = useState('')
  const [importing, setImporting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Desktop: search and Import move into the app header. Mobile: they stay above the table.
  const headerSlot = useHeaderToolbarSlot('ig-accounts-header-slot', 300)

  const isConnectOpen = Boolean(profileId)

  function openImport() {
    setError('')
    setIsImportOpen(true)
  }

  async function importText(value: string, opts?: { closeOnSuccess?: boolean }) {
    if (!value.trim() || importing) return
    setImporting(true)
    setError('')
    setNotice('')
    try {
      const result = await apiFetch<{ imported: number; skipped: number }>(
        '/api/ig-accounts/import',
        { method: 'POST', body: { text: value } },
      )
      setNotice(`Imported ${result.imported}; skipped ${result.skipped} duplicates.`)
      setText('')
      await refresh()
      if (opts?.closeOnSuccess) setIsImportOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  async function connect() {
    if (!profileId || connecting || (!selected && !text.trim())) return
    setConnecting(true)
    setError('')
    setNotice('')
    try {
      await apiFetch(`/api/ig-accounts/${encodeURIComponent(profileId)}/connect`, {
        method: 'POST',
        body: selected ? { credentialId: selected } : { credentials: text.trim() },
        timeout: 90_000,
      })
      await refresh()
      navigate('/profiles')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConnecting(false)
    }
  }

  async function reconnect(account: Account) {
    if (reconnectingId || !account.profileId) return
    setReconnectingId(account.id)
    setError('')
    setNotice('')
    try {
      await apiFetch(`/api/ig-accounts/${encodeURIComponent(account.profileId)}/connect`, {
        method: 'POST',
        body: { credentialId: account.id },
        timeout: 360_000,
      })
      setNotice(`@${account.username} reconnected.`)
      await refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Reconnect failed')
    } finally {
      setReconnectingId(null)
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-shell text-ink">
      {headerSlot
        ? createPortal(
            <AccountsToolbar
              search={search}
              onSearchChange={setSearch}
              loading={loading}
              onImport={openImport}
            />,
            headerSlot,
          )
        : null}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {!headerSlot && (
          <div className="px-4 pt-3 pb-3">
            <AccountsToolbar
              search={search}
              onSearchChange={setSearch}
              loading={loading}
              onImport={openImport}
            />
          </div>
        )}

        <div className="flex flex-none flex-col gap-3 px-4 pt-3 empty:hidden md:px-6">
          {(error || loadError) && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-status-danger-border bg-status-danger-soft px-4 py-2.5 text-sm text-status-danger"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{error || loadError}</span>
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-status-success-border bg-status-success-soft px-4 py-2.5 text-sm text-status-success"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{notice}</span>
            </div>
          )}
        </div>

        <TableCard pagination={{ ...pagination, pageSize, onPageSizeChange: setPageSize }}>
          <AccountsList
            accounts={filteredAccounts}
            loading={loading}
            onSelect={setDetailsAccount}
            onReconnect={(account) => void reconnect(account)}
            reconnectingId={reconnectingId}
            emptyTitle={search.trim() ? 'No matching accounts' : 'No accounts'}
            emptyDescription={
              search.trim()
                ? 'Try a different search term or clear the filter.'
                : 'Import credentials to get started.'
            }
          />
        </TableCard>
      </div>

      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Import credentials</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <p className="text-sm text-subtle-copy">One per line: username:password:2FA key</p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="username:password:2FA key (one per line)"
              className="min-h-28 brand-focus border-line bg-field font-mono text-xs text-ink"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={importing}
              className="h-8 justify-self-start button-panel font-medium"
              asChild
            >
              <label className="cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                {importing ? 'Importing...' : 'Import from TXT'}
                <input
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  disabled={importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file)
                      void file
                        .text()
                        .then((value) => importText(value, { closeOnSuccess: true }))
                        .catch((err) => setError(String(err)))
                  }}
                />
              </label>
            </Button>
            {error && (
              <div className="rounded-md border border-status-danger-border bg-status-danger-soft p-3 text-sm font-medium text-status-danger">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-3 border-t border-line pt-4">
              <Button variant="ghost" onClick={() => setIsImportOpen(false)} disabled={importing}>
                Cancel
              </Button>
              <Button
                onClick={() => void importText(text, { closeOnSuccess: true })}
                disabled={importing || !text.trim()}
                className="brand-button font-medium"
              >
                {importing ? 'Importing...' : 'Import pasted lines'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isConnectOpen}
        onOpenChange={(open) => {
          if (!open) navigate('/profiles')
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">Connect credential</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5">
            <p className="text-sm text-subtle-copy">
              Pick an imported credential or paste one below.
            </p>
            <div className="grid gap-1.5">
              <Label
                htmlFor="ig-credential"
                className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
              >
                Imported credential
              </Label>
              <Input
                value={credentialSearch}
                onChange={(event) => setCredentialSearch(event.target.value)}
                placeholder="Search imported credentials..."
                aria-label="Search imported credentials"
              />
              <Select
                value={selected}
                onValueChange={(id) => {
                  setSelected(id)
                  const row = connectable.find((account) => account.id === id)
                  if (row) setSelectedLabel('@' + row.username + ' · ' + row.status)
                }}
              >
                <SelectTrigger
                  id="ig-credential"
                  className="brand-focus border-line bg-field text-ink"
                >
                  <SelectValue placeholder="Paste below or choose an imported credential">
                    {selectedLabel || undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="panel-dropdown">
                  {connectable.map((a) => (
                    <SelectItem
                      key={a.id}
                      value={a.id}
                      className="cursor-pointer focus:bg-panel-hover focus:text-ink"
                    >
                      @{a.username} · {a.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TablePagination {...options.pagination} />
              {options.error && (
                <p role="alert" className="text-sm text-status-danger">
                  {options.error}
                </p>
              )}
            </div>
            {!selected && (
              <div className="grid gap-1.5">
                <Label
                  htmlFor="ig-credential-paste"
                  className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
                >
                  Paste credential
                </Label>
                <Input
                  id="ig-credential-paste"
                  type="password"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="username:password:2FA key"
                  className="brand-focus border-line bg-field font-mono text-sm text-ink"
                />
              </div>
            )}
            {error && (
              <div className="rounded-md border border-status-danger-border bg-status-danger-soft p-3 text-sm font-medium text-status-danger">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-3 border-t border-line pt-4">
              <Button variant="ghost" onClick={() => navigate('/profiles')} disabled={connecting}>
                Cancel
              </Button>
              <Button
                onClick={() => void connect()}
                disabled={connecting || (!selected && !text.trim())}
                className="brand-button font-medium"
              >
                {connecting ? 'Connecting...' : 'Connect Chat'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AccountDetailsDialog account={detailsAccount} onClose={() => setDetailsAccount(null)} />
    </div>
  )
}

/* ── Search + Import (header on desktop, above table on mobile) ── */

function AccountsToolbar({
  search,
  onSearchChange,
  loading,
  onImport,
}: {
  search: string
  onSearchChange: (value: string) => void
  loading: boolean
  onImport: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-[280px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search accounts..."
          className="h-8 rounded-md brand-focus border-line bg-field pr-8 pl-9 text-sm leading-5 font-normal text-copy shadow-sm placeholder:text-muted-copy"
        />
      </div>
      <Button
        size="sm"
        onClick={onImport}
        disabled={loading}
        className="h-8 shrink-0 brand-button font-medium"
      >
        <Plus className="mr-2 h-3.5 w-3.5" /> Import
      </Button>
    </div>
  )
}
