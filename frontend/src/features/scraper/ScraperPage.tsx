import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNow } from '@/hooks/use-now'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { Pencil, Plus, RotateCcw, Search, Trash2, UserCheck } from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { useLocation, useNavigate } from '@/lib/router'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LeadsList } from './LeadsList'
import { SCRAPER_TABS, parseScraperTab, type ScraperTabId } from './scraperTabs'

import { ScrapeSourcesView } from './ScrapeSourcesView'
import { useLeadListSummary } from './useLeadListSummary'

type Account = {
  id: Id<'profiles'>
  name: string
  ready: boolean
  dailyLimit?: number
  used: number
  cooldownUntil?: number
}

export function ScraperPage() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const tab = parseScraperTab(new URLSearchParams(search).get('tab'))
  const setTab = (next: ScraperTabId) => {
    if (next !== tab) navigate(`/scraper?tab=${next}`)
  }

  return (
    <FilterProvider>
      <div className="relative flex h-full flex-col bg-shell text-ink">
        <ScraperToolbar tab={tab} onTabChange={setTab} />

        <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
          <div className="mx-auto max-w-[2000px] space-y-4">
            {tab === 'sources' && <SourcesTab />}
            {tab === 'accounts' && <AccountsView />}
            {tab === 'saved' && <SavedView />}
          </div>
        </div>
      </div>
    </FilterProvider>
  )
}

/* ── Toolbar: mobile tabs and filters for the selected tab ── */

function ScraperToolbar({
  tab,
  onTabChange,
}: {
  tab: ScraperTabId
  onTabChange: (tab: ScraperTabId) => void
}) {
  const { search } = useLocation()
  const listOpen = tab === 'sources' && new URLSearchParams(search).get('listId')
  const showFiltersRow = (tab === 'sources' && !listOpen) || tab === 'accounts' || tab === 'saved'
  return (
    <div className="relative z-10 flex-none space-y-2 px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      {/* Header tabs live in the app header on desktop; show a local switch on mobile. */}
      <div className="flex items-center gap-1 rounded-full button-toolbar-group p-1 md:hidden">
        {SCRAPER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            aria-current={t.id === tab ? 'page' : undefined}
            className={cn(
              'h-7 flex-1 rounded-full px-2 text-xs font-medium whitespace-nowrap',
              t.id === tab ? 'bg-panel-muted text-ink shadow-xs' : 'text-muted-copy',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {showFiltersRow && (
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex flex-grow items-center gap-2">
            {tab === 'sources' && !listOpen && <ListsFilters />}
            {tab === 'accounts' && <AccountsFilters />}
            {tab === 'saved' && <SavedFilters />}
          </div>
          <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
            {tab === 'sources' && !listOpen && <NewListButton />}
            {tab === 'saved' && <RetryEnrichmentButton />}
          </div>
        </div>
      )}
    </div>
  )
}

function RetryEnrichmentButton() {
  const retryEnrichment = useMutation(api.scraper.retryEnrichment)
  return (
    <Button
      size="icon"
      variant="outline"
      title="Retry enrichment errors"
      aria-label="Retry enrichment errors"
      onClick={() =>
        void retryEnrichment({})
          .then((n) => toast.success(`${n} accounts queued for enrichment`))
          .catch((e) => toast.error(String(e)))
      }
      className="h-8 w-8"
    >
      <RotateCcw className="h-3.5 w-3.5" />
    </Button>
  )
}

function NewListButton() {
  const { setListCreateOpen } = useFilters()
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => setListCreateOpen(true)}
      className="h-8 font-medium"
    >
      <Plus className="mr-2 h-3.5 w-3.5" /> New list
    </Button>
  )
}

/* Filter state shared between the toolbar (top) and the active view (content). */

type FilterStore = {
  accountsQuery: string
  setAccountsQuery: (v: string) => void
  accountsStatus: string
  setAccountsStatus: (v: string) => void
  savedQuery: string
  setSavedQuery: (v: string) => void
  savedList: string
  setSavedList: (v: string) => void
  savedType: string
  setSavedType: (v: string) => void
  listsQuery: string
  setListsQuery: (v: string) => void
  listCreateOpen: boolean
  setListCreateOpen: (v: boolean) => void
}

const FiltersContext = createContext<FilterStore | null>(null)

function useFilters() {
  const ctx = useContext(FiltersContext)
  if (!ctx) throw new Error('FiltersContext missing')
  return ctx
}

// Single provider wraps toolbar + content so toolbar inputs edit the active view's filters.
function FilterProvider({ children }: { children: React.ReactNode }) {
  const [accountsQuery, setAccountsQuery] = useState('')
  const [accountsStatus, setAccountsStatus] = useState('all')
  const [savedQuery, setSavedQuery] = useState('')
  const [savedList, setSavedList] = useState('all')
  const [savedType, setSavedType] = useState('all')
  const [listsQuery, setListsQuery] = useState('')
  const [listCreateOpen, setListCreateOpen] = useState(false)
  const value = useMemo(
    () => ({
      accountsQuery,
      setAccountsQuery,
      accountsStatus,
      setAccountsStatus,
      savedQuery,
      setSavedQuery,
      savedList,
      setSavedList,
      savedType,
      setSavedType,
      listsQuery,
      setListsQuery,
      listCreateOpen,
      setListCreateOpen,
    }),
    [accountsQuery, accountsStatus, savedQuery, savedList, savedType, listsQuery, listCreateOpen],
  )
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
}

function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  label: string
}) {
  return (
    <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
      <Input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-md border brand-focus border-line bg-field pl-9 text-sm leading-5 font-normal text-copy shadow-sm placeholder:text-muted-copy"
      />
    </div>
  )
}

function AccountsFilters() {
  const f = useFilters()
  return (
    <>
      <SearchBox
        value={f.accountsQuery}
        onChange={f.setAccountsQuery}
        placeholder="Search scrapers..."
        label="Search scraping accounts"
      />
      <Select value={f.accountsStatus} onValueChange={f.setAccountsStatus}>
        <SelectTrigger
          aria-label="Account status"
          className="h-8 w-full border-line bg-field text-sm shadow-sm sm:w-[160px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="panel-dropdown">
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="ready">Ready</SelectItem>
          <SelectItem value="cooling">Cooling down</SelectItem>
          <SelectItem value="needs-session">Needs session</SelectItem>
        </SelectContent>
      </Select>
      <AccountsToolbarStats />
    </>
  )
}

function AccountsToolbarStats() {
  const now = useNow()
  const accounts = useQuery(api.scraper.accounts, {})
  const summary = useMemo(() => {
    let ready = 0
    let cooling = 0
    let needsSession = 0
    let used = 0
    let capacity = 0
    for (const a of accounts ?? []) {
      if (!a.ready) needsSession += 1
      else if (a.cooldownUntil && a.cooldownUntil > now) cooling += 1
      else ready += 1
      used += a.used
      if (a.dailyLimit !== undefined) capacity += a.dailyLimit
    }
    return { ready, cooling, needsSession, used, capacity }
  }, [accounts, now])

  if (!accounts?.length) return null
  return (
    <div className="hidden h-8 items-center gap-3 pl-1 md:flex" aria-label="Scraper capacity">
      <span className="inline-flex items-baseline gap-1.5 leading-none whitespace-nowrap">
        <span className="text-sm font-semibold text-ink tabular-nums">{summary.ready}</span>
        <span className="text-xs text-subtle-copy">ready</span>
      </span>
      {summary.cooling > 0 && (
        <span className="inline-flex items-baseline gap-1.5 leading-none whitespace-nowrap">
          <span className="text-sm font-semibold text-status-danger tabular-nums">
            {summary.cooling}
          </span>
          <span className="text-xs text-subtle-copy">cooling</span>
        </span>
      )}
      {summary.needsSession > 0 && (
        <span className="inline-flex items-baseline gap-1.5 leading-none whitespace-nowrap">
          <span className="text-sm font-semibold text-status-warning tabular-nums">
            {summary.needsSession}
          </span>
          <span className="text-xs text-subtle-copy">need session</span>
        </span>
      )}
      <span className="h-4 w-px bg-line" aria-hidden />
      <span className="text-xs whitespace-nowrap text-subtle-copy tabular-nums">
        {summary.used.toLocaleString()}
        {summary.capacity > 0 ? ` / ${summary.capacity.toLocaleString()} today` : ' today'}
      </span>
    </div>
  )
}

function SavedFilters() {
  const f = useFilters()
  const lists = useQuery(api.leads.lists, {})
  return (
    <>
      <SearchBox
        value={f.savedQuery}
        onChange={f.setSavedQuery}
        placeholder="Search leads..."
        label="Search leads"
      />
      <Select value={f.savedList} onValueChange={f.setSavedList}>
        <SelectTrigger
          aria-label="Lead list"
          className="h-8 w-full border-line bg-field text-sm shadow-sm sm:w-[180px]"
        >
          <SelectValue placeholder="All lists" />
        </SelectTrigger>
        <SelectContent className="panel-dropdown">
          <SelectItem value="all">All lists</SelectItem>
          {lists?.map((list) => (
            <SelectItem key={list._id} value={list._id}>
              {list.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={f.savedType} onValueChange={f.setSavedType}>
        <SelectTrigger
          aria-label="Account type"
          className="h-8 w-full border-line bg-field text-sm shadow-sm sm:w-[140px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="panel-dropdown">
          {['all', 'male', 'female', 'business'].map((value) => (
            <SelectItem key={value} value={value}>
              {value === 'all' ? 'All types' : value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}

function ListsFilters() {
  const f = useFilters()
  return (
    <SearchBox
      value={f.listsQuery}
      onChange={f.setListsQuery}
      placeholder="Search lists..."
      label="Search lead lists"
    />
  )
}

function AccountsView() {
  const now = useNow()
  const f = useFilters()
  const accounts = useQuery(api.scraper.accounts, {})
  const setLimit = useMutation(api.scraper.setDailyLimit)
  const mobile = useIsMobile()
  const [editTarget, setEditTarget] = useState<Account | null>(null)
  const [editBusy, setEditBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = f.accountsQuery.trim().toLowerCase()
    return (accounts ?? []).filter((a) => {
      if (q && !a.name.toLowerCase().includes(q)) return false
      const cooling = a.ready && a.cooldownUntil !== undefined && a.cooldownUntil > now
      if (f.accountsStatus === 'ready' && (!a.ready || cooling)) return false
      if (f.accountsStatus === 'cooling' && !cooling) return false
      if (f.accountsStatus === 'needs-session' && a.ready) return false
      return true
    })
  }, [accounts, f.accountsQuery, f.accountsStatus, now])

  const saveOne = async (limit: number | undefined) => {
    if (!editTarget) return
    setEditBusy(true)
    try {
      await setLimit({ profileId: editTarget.id, limit })
      toast.success(
        limit === undefined
          ? `No daily limit for ${editTarget.name}`
          : `Daily limit for ${editTarget.name}: ${limit.toLocaleString()}`,
      )
      setEditTarget(null)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setEditBusy(false)
    }
  }

  if (accounts === undefined) {
    return <div className="p-12 text-center text-sm text-muted-foreground">Loading accounts...</div>
  }

  if (!accounts.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
        <UserCheck className="mb-4 h-10 w-10 text-subtle-copy" />
        <h3 className="text-lg font-medium text-ink">No profiles available</h3>
        <p className="mt-1 text-sm text-subtle-copy">Create a profile to start scraping.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!filtered.length ? (
        <div className="rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
          <p className="text-sm font-medium text-ink">No matching accounts</p>
          <p className="mt-1 text-sm text-subtle-copy">Try a different search term or status.</p>
        </div>
      ) : mobile ? (
        <div className="space-y-3">
          {filtered.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              now={now}
              onEdit={() => setEditTarget(account)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line-soft bg-panel-subtle shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-line-soft bg-transparent hover:bg-transparent">
                <TableHead className="h-12 pl-4 font-medium text-muted-copy">Account</TableHead>
                <TableHead className="h-12 w-[130px] font-medium text-muted-copy">Status</TableHead>
                <TableHead className="h-12 w-[300px] pr-4 font-medium text-muted-copy">
                  Quota today
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((account) => (
                <AccountDesktopRow
                  key={account.id}
                  account={account}
                  now={now}
                  onEdit={() => setEditTarget(account)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editTarget && (
        <LimitDialog
          key={editTarget.id}
          title={`Daily limit · ${editTarget.name}`}
          subtitle={
            editTarget.dailyLimit === undefined
              ? 'Currently no limit.'
              : `Currently ${editTarget.dailyLimit.toLocaleString()} per day.`
          }
          initialLimit={editTarget.dailyLimit}
          busy={editBusy}
          onSave={(limit) => void saveOne(limit)}
          onClose={() => {
            if (!editBusy) setEditTarget(null)
          }}
        />
      )}
    </div>
  )
}

function accountStatus(account: Account, now: number) {
  if (!account.ready)
    return {
      label: 'Needs session',
      className: 'bg-panel-muted text-copy border-line',
      dot: 'bg-subtle-copy',
    }
  if (account.cooldownUntil && account.cooldownUntil > now)
    return {
      label: 'Cooling down',
      className: 'bg-status-danger-soft text-status-danger border-status-danger-border',
      dot: 'status-dot-danger',
    }
  return {
    label: 'Ready',
    className: 'bg-status-success-soft text-status-success border-status-success-border',
    dot: 'status-dot-success-tight',
  }
}

function UsageBar({ used, limit }: { used: number; limit?: number }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const fill =
    pct >= 90 ? 'bg-status-danger' : pct >= 70 ? 'bg-status-warning' : 'bg-status-success'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-copy tabular-nums">
          {limit
            ? `${used.toLocaleString()} / ${limit.toLocaleString()}`
            : `${used.toLocaleString()} · no limit`}
        </span>
        <span className="text-subtle-copy tabular-nums">{limit ? `${pct}%` : ''}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-muted">
        <div className={cn('h-full rounded-full', fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function LimitDialog({
  title,
  subtitle,
  initialLimit,
  busy,
  onSave,
  onClose,
}: {
  title: string
  subtitle?: string
  initialLimit?: number
  busy: boolean
  onSave: (limit: number | undefined) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialLimit?.toString() ?? '')
  const empty = value.trim() === ''
  const parsed = Number(value)
  const valid = empty || (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100000)
  const unchanged = (empty ? undefined : parsed) === initialLimit

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[400px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="page-title-gradient">{title}</DialogTitle>
        </DialogHeader>
        {subtitle && <p className="text-sm text-subtle-copy">{subtitle}</p>}
        <div className="grid gap-2 py-1">
          <Label htmlFor="scraper-limit-value">Daily limit</Label>
          <Input
            id="scraper-limit-value"
            type="number"
            min={1}
            max={100000}
            placeholder="No limit"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid && !busy && !unchanged)
                onSave(empty ? undefined : parsed)
            }}
            className="brand-focus border-line bg-field"
            autoFocus
          />
          <p className="text-xs text-subtle-copy">
            {valid
              ? 'Leave empty for no limit.'
              : 'Enter a whole number from 1 to 100000, or leave empty.'}
          </p>
        </div>
        <DialogFooter className="shrink-0 gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy} className="button-ghost">
            Cancel
          </Button>
          <Button
            onClick={() => onSave(empty ? undefined : parsed)}
            disabled={busy || !valid || unchanged}
            className="brand-button"
          >
            {busy ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccountDesktopRow({
  account,
  now,
  onEdit,
}: {
  account: Account
  now: number
  onEdit: () => void
}) {
  const status = accountStatus(account, now)
  return (
    <TableRow className="group h-14 border-b border-line-soft hover:bg-panel-subtle">
      <TableCell className="pl-4 font-medium">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-ink">{account.name}</span>
          {account.ready && account.cooldownUntil && account.cooldownUntil > now && (
            <span className="text-xs font-normal text-status-danger">
              Instagram 429 · retry after {new Date(account.cooldownUntil).toLocaleTimeString()}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
            status.className,
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>
      </TableCell>
      <TableCell className="pr-4">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <UsageBar used={account.used} limit={account.dailyLimit} />
          </div>
          <Button
            size="icon"
            variant="ghost"
            title={`Edit ${account.name} daily limit`}
            aria-label={`Edit ${account.name} daily limit`}
            onClick={onEdit}
            className="h-8 w-8 shrink-0 text-muted-copy hover:bg-panel-muted hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function AccountCard({
  account,
  now,
  onEdit,
}: {
  account: Account
  now: number
  onEdit: () => void
}) {
  const status = accountStatus(account, now)
  return (
    <div className="rounded-2xl border border-line bg-panel-strong p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink">{account.name}</h3>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
            status.className,
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>
      </div>
      {account.ready && account.cooldownUntil && account.cooldownUntil > now && (
        <p className="mt-2 text-xs text-status-danger">
          Instagram 429 · retry after {new Date(account.cooldownUntil).toLocaleTimeString()}
        </p>
      )}
      <div className="mt-3">
        <UsageBar used={account.used} limit={account.dailyLimit} />
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <Button variant="outline" size="sm" className="h-8 w-full font-medium" onClick={onEdit}>
          <Pencil className="mr-2 h-3.5 w-3.5" /> Edit daily limit
        </Button>
      </div>
    </div>
  )
}

/* ── Leads view ── */

function useDebouncedSearch(value: string) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), 300)
    return () => clearTimeout(timer)
  }, [value])
  return settled
}

function SavedView() {
  const f = useFilters()
  const searchInput = f.savedQuery.trim().toLowerCase()
  const search = useDebouncedSearch(searchInput)
  const searchPending = search !== searchInput
  const filterKey = JSON.stringify([f.savedList, f.savedType, search])
  const [pagination, setPagination] = useState({ key: filterKey, count: 100 })
  if (pagination.key !== filterKey) {
    setPagination({ key: filterKey, count: 100 })
  }
  const visibleCount = pagination.key === filterKey ? pagination.count : 100
  const {
    results: leads,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.leads.listPage,
    {
      listId: f.savedList === 'all' ? undefined : (f.savedList as Id<'leadLists'>),
      classification:
        f.savedType === 'all' ? undefined : (f.savedType as 'male' | 'female' | 'business'),
      search: search || undefined,
    },
    { initialNumItems: 100 },
  )

  useEffect(() => {
    if (!searchPending && pageStatus === 'CanLoadMore' && leads.length < visibleCount) loadMore(100)
  }, [searchPending, pageStatus, leads.length, visibleCount, loadMore])

  const fillingPage = leads.length < visibleCount && pageStatus !== 'Exhausted'
  const hasMore = leads.length > visibleCount || pageStatus !== 'Exhausted'

  return (
    <div className="space-y-3">
      <LeadsList
        leads={leads.slice(0, visibleCount)}
        loading={
          pageStatus === 'LoadingFirstPage' || (pageStatus !== 'Exhausted' && leads.length === 0)
        }
        hasActiveFilter={!!f.savedQuery || f.savedList !== 'all' || f.savedType !== 'all'}
      />
      {hasMore && (
        <Button
          variant="outline"
          disabled={searchPending || fillingPage}
          onClick={() => setPagination({ key: filterKey, count: visibleCount + 100 })}
        >
          {fillingPage ? 'Loading accounts...' : 'Load more accounts'}
        </Button>
      )}
    </div>
  )
}

/* ── Sources tab: lists overview, or one list's detail when listId is set ── */

function SourcesTab() {
  const { search } = useLocation()
  const listId = new URLSearchParams(search).get('listId')
  return listId ? <ScrapeSourcesView /> : <ListsTable />
}

/* ── Lists overview table ── */

type LeadList = { _id: Id<'leadLists'>; name: string; createdAt: number }

function ListsTable() {
  const f = useFilters()
  const lists = useQuery(api.leads.lists, {})
  const mobile = useIsMobile()
  const navigate = useNavigate()
  const [renameTarget, setRenameTarget] = useState<LeadList | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LeadList | null>(null)
  const queryText = f.listsQuery.trim().toLowerCase()
  const [page, setPage] = useState({ query: queryText, count: 20 })
  if (page.query !== queryText) setPage({ query: queryText, count: 20 })
  const visibleCount = page.query === queryText ? page.count : 20

  const filtered = useMemo(() => {
    const q = f.listsQuery.trim().toLowerCase()
    if (!q) return lists ?? []
    return (lists ?? []).filter((l) => l.name.toLowerCase().includes(q))
  }, [lists, f.listsQuery])

  if (lists === undefined) {
    return <div className="p-12 text-center text-sm text-muted-foreground">Loading lists...</div>
  }

  if (!lists.length) {
    return (
      <>
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
          <h3 className="text-lg font-medium text-ink">No lead lists yet</h3>
          <p className="mt-1 text-sm text-subtle-copy">Create a list to organize scraped leads.</p>
        </div>
        <LeadListCreateDialog open={f.listCreateOpen} onOpenChange={f.setListCreateOpen} />
      </>
    )
  }

  const openList = (id: Id<'leadLists'>) => navigate(`/scraper?tab=sources&listId=${id}`)
  const visibleLists = filtered.slice(0, visibleCount)

  return (
    <div className="space-y-4">
      {!filtered.length ? (
        <div className="rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
          <p className="text-sm font-medium text-ink">No matching lists</p>
          <p className="mt-1 text-sm text-subtle-copy">Try a different search term.</p>
        </div>
      ) : mobile ? (
        <div className="space-y-3">
          {visibleLists.map((list) => (
            <SourcesListCard
              key={list._id}
              list={list}
              onOpen={() => openList(list._id)}
              onRename={() => setRenameTarget(list)}
              onDelete={() => setDeleteTarget(list)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line-soft bg-panel-subtle shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-line-soft bg-transparent hover:bg-transparent">
                <TableHead className="h-12 pl-4 font-medium text-muted-copy">List</TableHead>
                <TableHead className="h-12 w-[100px] font-medium text-muted-copy">
                  Sources
                </TableHead>
                <TableHead className="h-12 w-[100px] font-medium text-muted-copy">Leads</TableHead>
                <TableHead className="h-12 w-[130px] font-medium text-muted-copy">
                  Created
                </TableHead>
                <TableHead className="h-12 w-[110px] pr-4 text-right font-medium text-muted-copy">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLists.map((list) => (
                <SourcesListRow
                  key={list._id}
                  list={list}
                  onOpen={() => openList(list._id)}
                  onRename={() => setRenameTarget(list)}
                  onDelete={() => setDeleteTarget(list)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {visibleCount < filtered.length && (
        <Button
          variant="outline"
          onClick={() => setPage({ query: queryText, count: visibleCount + 20 })}
        >
          Load more lists
        </Button>
      )}
      <LeadListCreateDialog open={f.listCreateOpen} onOpenChange={f.setListCreateOpen} />
      <LeadListRenameDialog
        list={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      />
      {deleteTarget && (
        <LeadListDeleteDialog list={deleteTarget} onCancel={() => setDeleteTarget(null)} />
      )}
    </div>
  )
}

function SourcesListRow({
  list,
  onOpen,
  onRename,
  onDelete,
}: {
  list: LeadList
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLTableRowElement>(null)
  const visible = useNearViewport(ref)
  const counts = useLeadListSummary(list._id, visible)
  return (
    <TableRow
      ref={ref}
      className="group h-14 cursor-pointer border-b border-line-soft hover:bg-panel-subtle"
      onClick={onOpen}
    >
      <TableCell className="pl-4 font-medium text-ink">
        <button
          type="button"
          className="rounded-sm text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
        >
          {list.name}
        </button>
      </TableCell>
      <TableCell className="text-sm text-copy tabular-nums">
        {counts === undefined ? '—' : counts.sources}
      </TableCell>
      <TableCell className="text-sm text-copy tabular-nums">
        {counts?.leads == null ? '—' : counts.leads.toLocaleString()}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap text-muted-copy">
        {new Date(list.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            title="Rename list"
            aria-label={`Rename ${list.name}`}
            className="h-8 w-8 text-muted-copy hover:bg-panel-muted hover:text-ink"
            onClick={onRename}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Delete list"
            aria-label={`Delete ${list.name}`}
            className="h-8 w-8 text-status-danger hover:bg-status-danger-soft"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function SourcesListCard({
  list,
  onOpen,
  onRename,
  onDelete,
}: {
  list: LeadList
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useNearViewport(ref)
  const counts = useLeadListSummary(list._id, visible)
  return (
    <div ref={ref} className="rounded-2xl border border-line bg-panel-strong p-4 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <button
          className="min-w-0 flex-1 truncate text-left text-base font-semibold brand-link"
          onClick={onOpen}
        >
          {list.name}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Rename ${list.name}`}
            className="h-8 w-8 text-muted-copy hover:bg-panel-muted hover:text-ink"
            onClick={onRename}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${list.name}`}
            className="h-8 w-8 text-status-danger hover:bg-status-danger-soft"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-subtle-copy tabular-nums">
        {counts === undefined
          ? '…'
          : `${counts.sources} ${counts.sources === 1 ? 'source' : 'sources'} · ${counts.leads?.toLocaleString() ?? '…'} ${counts.leads === 1 ? 'lead' : 'leads'}`}{' '}
        · Created {new Date(list.createdAt).toLocaleDateString()}
      </p>
    </div>
  )
}

function LeadListCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createList = useMutation(api.leads.createList)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setBusy(false)
    }
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (busy || !trimmed) return
    setBusy(true)
    try {
      await createList({ name: trimmed })
      toast.success(`List "${trimmed}" created`)
      onOpenChange(false)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[440px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="page-title-gradient">New lead list</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 py-1">
          <Label htmlFor="scraper-new-list-name">List name</Label>
          <Input
            id="scraper-new-list-name"
            placeholder="e.g. Downtown gyms"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            className="brand-focus border-line bg-field"
            autoFocus
          />
        </div>
        <DialogFooter className="shrink-0 gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="button-ghost"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            className="brand-button"
          >
            Create list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeadListRenameDialog({
  list,
  onOpenChange,
}: {
  list: LeadList | null
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(list?.name ?? '')
  const [busy, setBusy] = useState(false)

  const [previousList, setPreviousList] = useState(list)
  if (list !== previousList) {
    setPreviousList(list)
    if (list) {
      setName(list.name)
      setBusy(false)
    }
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (busy || !list || !trimmed || trimmed === list.name) return
    setBusy(true)
    try {
      await apiFetch('/api/lead-lists/rename', {
        method: 'POST',
        body: { listId: list._id, name: trimmed },
      })
      toast.success('List renamed')
      onOpenChange(false)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(list)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[440px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="page-title-gradient">Rename list</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 py-1">
          <Label htmlFor="scraper-rename-list-name">List name</Label>
          <Input
            id="scraper-rename-list-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            className="brand-focus border-line bg-field"
            autoFocus
          />
        </div>
        <DialogFooter className="shrink-0 gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="button-ghost"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !name.trim() || name.trim() === list?.name}
            className="brand-button"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeadListDeleteDialog({ list, onCancel }: { list: LeadList; onCancel: () => void }) {
  const [saving, setSaving] = useState(false)

  const confirm = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/lead-lists/delete', { method: 'POST', body: { listId: list._id } })
      toast.success(`List "${list.name}" deleted`)
      onCancel()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfirmDeleteDialog
      open
      title="Delete List?"
      entityLabel=""
      itemName={list.name}
      confirmLabel="Delete List"
      saving={saving}
      error={null}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    />
  )
}
