import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Plus,
  Search,
  Upload,
} from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [detailsAccount, setDetailsAccount] = useState<Account | null>(null)

  const [text, setText] = useState('')
  const [selected, setSelected] = useState('')
  const [importing, setImporting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const isConnectOpen = Boolean(profileId)

  const refresh = useCallback(async () => {
    const accountRows = await apiFetch<Account[]>('/api/ig-accounts')
    setAccounts(accountRows)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void apiFetch<Account[]>('/api/ig-accounts', { signal: controller.signal })
      .then((rows) => { if (!controller.signal.aborted) setAccounts(rows) })
      .catch((error) => { if (!controller.signal.aborted) setError(String(error)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter((a) => a.username.toLowerCase().includes(q))
  }, [accounts, search])

  const connectable = useMemo(
    () =>
      accounts.filter((a) => a.status === 'available' || a.profileId === profileId),
    [accounts, profileId],
  )

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
      setNotice(
        `Imported ${result.imported}; skipped ${result.skipped} duplicates.`,
      )
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
      await apiFetch(
        `/api/ig-accounts/${encodeURIComponent(profileId)}/connect`,
        {
          method: 'POST',
          body: selected
            ? { credentialId: selected }
            : { credentials: text.trim() },
          timeout: 90_000,
        },
      )
      await refresh()
      navigate('/profiles')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
          <div className="flex flex-grow items-center gap-2">
            <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
              <Search className="text-muted-copy pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search accounts..."
                className="bg-field border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pr-8 pl-9 text-sm leading-5 font-normal shadow-sm"
              />
            </div>
          </div>
          <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
            <Button
              size="sm"
              onClick={() => {
                setError('')
                setIsImportOpen(true)
              }}
              disabled={loading}
              className="mobile-effect-shadow brand-button h-8 font-medium"
            >
              <Plus className="mr-2 h-3.5 w-3.5" /> Import
            </Button>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px] space-y-4">
          {error && (
            <div
              role="alert"
              className="text-status-danger bg-status-danger-soft border-status-danger-border flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="border-status-success-border bg-status-success-soft text-status-success flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{notice}</span>
            </div>
          )}

          <AccountsList
            accounts={filteredAccounts}
            loading={loading}
            onSelect={setDetailsAccount}
            emptyTitle={search.trim() ? 'No matching accounts' : 'No accounts'}
            emptyDescription={
              search.trim()
                ? 'Try a different search term or clear the filter.'
                : 'Import credentials to get started.'
            }
          />

        </div>
      </div>

      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">
              Import credentials
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <p className="text-subtle-copy text-sm">
              One per line: username:password:2FA key
            </p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="username:password:2FA key (one per line)"
              className="brand-focus bg-field border-line min-h-28 font-mono text-xs text-ink"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={importing}
              className="button-panel h-8 justify-self-start font-medium"
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
                        .then((value) =>
                          importText(value, { closeOnSuccess: true }),
                        )
                        .catch((err) => setError(String(err)))
                  }}
                />
              </label>
            </Button>
            {error && (
              <div className="text-status-danger bg-status-danger-soft border-status-danger-border rounded-md border p-3 text-sm font-medium">
                {error}
              </div>
            )}
            <div className="border-line flex justify-end gap-3 border-t pt-4">
              <Button
                variant="ghost"
                onClick={() => setIsImportOpen(false)}
                disabled={importing}
              >
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
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[560px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">
              Connect credential
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-5">
            <p className="text-subtle-copy text-sm">
              Pick an imported credential or paste one below.
            </p>
            <div className="grid gap-1.5">
              <Label
                htmlFor="ig-credential"
                className="text-muted-copy text-xs font-semibold tracking-wider uppercase"
              >
                Imported credential
              </Label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger
                  id="ig-credential"
                  className="brand-focus bg-field border-line text-ink"
                >
                  <SelectValue placeholder="Paste below or choose an imported credential" />
                </SelectTrigger>
                <SelectContent className="panel-dropdown">
                  {connectable.map((a) => (
                    <SelectItem
                      key={a.id}
                      value={a.id}
                      className="focus:bg-panel-hover cursor-pointer focus:text-ink"
                    >
                      @{a.username} · {a.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!selected && (
              <div className="grid gap-1.5">
                <Label
                  htmlFor="ig-credential-paste"
                  className="text-muted-copy text-xs font-semibold tracking-wider uppercase"
                >
                  Paste credential
                </Label>
                <Input
                  id="ig-credential-paste"
                  type="password"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="username:password:2FA key"
                  className="brand-focus bg-field border-line font-mono text-sm text-ink"
                />
              </div>
            )}
            {error && (
              <div className="text-status-danger bg-status-danger-soft border-status-danger-border rounded-md border p-3 text-sm font-medium">
                {error}
              </div>
            )}
            <div className="border-line flex justify-end gap-3 border-t pt-4">
              <Button
                variant="ghost"
                onClick={() => navigate('/profiles')}
                disabled={connecting}
              >
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

      <AccountDetailsDialog
        account={detailsAccount}
        onClose={() => setDetailsAccount(null)}
      />
    </div>
  )
}
