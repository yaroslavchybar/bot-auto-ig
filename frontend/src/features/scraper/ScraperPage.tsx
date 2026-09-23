import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { Inbox, Pencil, Plus, RotateCcw, Search, Trash2, UserCheck } from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { useLocation, useNavigate } from '@/lib/router'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LeadsList } from './LeadsList'
import { SCRAPER_TABS, parseScraperTab, type ScraperTabId } from './scraperTabs'

const splitLinks = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean)

type Account = {
  id: Id<'profiles'>
  name: string
  ready: boolean
  dailyLimit: number
  used: number
  cooldownUntil?: number
}

type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'paused'

const JOB_STATUSES: JobStatus[] = ['queued', 'running', 'completed', 'failed', 'paused']

function jobBadgeClass(status: string) {
  switch (status) {
    case 'queued':
      return 'bg-status-info-soft text-status-info border-status-info-border'
    case 'running':
      return 'bg-status-warning-soft text-status-warning border-status-warning-border'
    case 'completed':
      return 'bg-status-success-soft text-status-success border-status-success-border'
    case 'failed':
      return 'bg-status-danger-soft text-status-danger border-status-danger-border'
    default:
      return 'bg-panel-muted text-copy border-line'
  }
}

function JobStatusBadge({ status }: { status: string }) {
  const dot =
    status === 'completed'
      ? 'status-dot-success-tight'
      : status === 'failed'
        ? 'status-dot-danger'
        : status === 'running'
          ? 'bg-status-warning'
          : status === 'queued'
            ? 'bg-status-info'
            : 'bg-subtle-copy'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        jobBadgeClass(status),
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {status}
    </span>
  )
}

export function ScraperPage() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const tab = parseScraperTab(new URLSearchParams(search).get('tab'))
  const setTab = (next: ScraperTabId) => {
    if (next !== tab) navigate(`/scraper?tab=${next}`)
  }

  const [jobOpen, setJobOpen] = useState(false)

  return (
    <FilterProvider>
      <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
        <ScraperToolbar tab={tab} onTabChange={setTab} onNewJob={() => setJobOpen(true)} />

        <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
          <div className="mx-auto max-w-[2000px] space-y-4">
            {tab === 'jobs' && <JobsView />}
            {tab === 'accounts' && <AccountsView />}
            {tab === 'saved' && <SavedView />}
            {tab === 'lists' && <ListsView />}
          </div>
        </div>

        <NewJobDialog open={jobOpen} onOpenChange={setJobOpen} />
      </div>
    </FilterProvider>
  )
}

/* ── Toolbar: mobile tabs + per-tab filters + New job button ── */

function ScraperToolbar({
  tab,
  onTabChange,
  onNewJob,
}: {
  tab: ScraperTabId
  onTabChange: (tab: ScraperTabId) => void
  onNewJob: () => void
}) {
  return (
    <div className="relative z-10 flex-none space-y-2 px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      {/* Header tabs live in the app header on desktop; show a local switch on mobile. */}
      <div className="button-toolbar-group flex items-center gap-1 rounded-full p-1 md:hidden">
        {SCRAPER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            aria-current={t.id === tab ? 'page' : undefined}
            className={cn(
              'h-7 flex-1 rounded-full px-2 text-xs font-medium whitespace-nowrap transition-colors',
              t.id === tab ? 'bg-panel-muted text-ink shadow-xs' : 'text-muted-copy',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-grow items-center gap-2">
          {tab === 'jobs' && <JobsFilters />}
          {tab === 'accounts' && <AccountsFilters />}
          {tab === 'saved' && <SavedFilters />}
          {tab === 'lists' && <ListsFilters />}
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
          {tab === 'lists' && <NewListButton />}
          {tab === 'saved' && <RetryEnrichmentButton />}
          <Button
            size="sm"
            onClick={onNewJob}
            className="mobile-effect-shadow brand-button h-8 font-medium"
          >
            <Plus className="mr-2 h-3.5 w-3.5" /> New job
          </Button>
        </div>
      </div>
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
    <Button size="sm" variant="outline" onClick={() => setListCreateOpen(true)} className="h-8 font-medium">
      <Plus className="mr-2 h-3.5 w-3.5" /> New list
    </Button>
  )
}

/* Filter state shared between the toolbar (top) and the active view (content). */

type FilterStore = {
  jobsQuery: string
  setJobsQuery: (v: string) => void
  jobsStatus: string
  setJobsStatus: (v: string) => void
  accountsQuery: string
  setAccountsQuery: (v: string) => void
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
  const [jobsQuery, setJobsQuery] = useState('')
  const [jobsStatus, setJobsStatus] = useState('all')
  const [accountsQuery, setAccountsQuery] = useState('')
  const [savedQuery, setSavedQuery] = useState('')
  const [savedList, setSavedList] = useState('all')
  const [savedType, setSavedType] = useState('all')
  const [listsQuery, setListsQuery] = useState('')
  const [listCreateOpen, setListCreateOpen] = useState(false)
  const value = useMemo(
    () => ({
      jobsQuery,
      setJobsQuery,
      jobsStatus,
      setJobsStatus,
      accountsQuery,
      setAccountsQuery,
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
    [jobsQuery, jobsStatus, accountsQuery, savedQuery, savedList, savedType, listsQuery, listCreateOpen],
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
        className="bg-field border border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pl-9 text-sm leading-5 font-normal shadow-sm"
      />
    </div>
  )
}

function JobsFilters() {
  const f = useFilters()
  const jobs = useQuery(api.scraper.jobs, {})
  const counts = useMemo(() => {
    const base = { queued: 0, running: 0, completed: 0, failed: 0 }
    jobs?.forEach((j) => {
      if (j.status in base) base[j.status as keyof typeof base] += 1
    })
    return base
  }, [jobs])
  return (
    <>
      <SearchBox value={f.jobsQuery} onChange={f.setJobsQuery} placeholder="Search jobs..." label="Search jobs" />
      <Select value={f.jobsStatus} onValueChange={f.setJobsStatus}>
        <SelectTrigger aria-label="Job status" className="bg-field border-line h-8 w-full text-sm shadow-sm sm:w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="panel-dropdown">
          <SelectItem value="all">All statuses</SelectItem>
          {JOB_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="hidden h-8 items-center gap-4 pl-1 lg:flex" aria-label="Job counts">
        {(
          [
            ['Queued', counts.queued, 'text-status-info'],
            ['Running', counts.running, 'text-status-warning'],
            ['Completed', counts.completed, 'text-status-success'],
            ['Failed', counts.failed, 'text-status-danger'],
          ] as const
        ).map(([label, value, tone]) => (
          <span key={label} className="inline-flex items-center gap-1.5 leading-none whitespace-nowrap">
            <span className="text-subtle-copy text-xs font-medium">{label}</span>
            <span className={cn('text-sm leading-none font-semibold tabular-nums', tone)}>{value}</span>
          </span>
        ))}
      </div>
    </>
  )
}

function AccountsFilters() {
  const f = useFilters()
  return (
    <SearchBox value={f.accountsQuery} onChange={f.setAccountsQuery} placeholder="Search accounts..." label="Search scraping accounts" />
  )
}

function SavedFilters() {
  const f = useFilters()
  const lists = useQuery(api.leads.lists, {})
  return (
    <>
      <SearchBox value={f.savedQuery} onChange={f.setSavedQuery} placeholder="Search accounts" label="Search saved accounts" />
      <Select value={f.savedList} onValueChange={f.setSavedList}>
        <SelectTrigger aria-label="Lead list" className="bg-field border-line h-8 w-full text-sm shadow-sm sm:w-[180px]">
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
        <SelectTrigger aria-label="Account type" className="bg-field border-line h-8 w-full text-sm shadow-sm sm:w-[140px]">
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
    <SearchBox value={f.listsQuery} onChange={f.setListsQuery} placeholder="Search lists..." label="Search lead lists" />
  )
}

/* ── Jobs view ── */

function JobsView() {
  const f = useFilters()
  const jobs = useQuery(api.scraper.jobs, {})
  const lists = useQuery(api.leads.lists, {})
  const retryJob = useMutation(api.scraper.retryJob)
  const mobile = useIsMobile()

  const listName = useMemo(() => {
    const map = new Map<string, string>()
    lists?.forEach((l) => map.set(l._id, l.name))
    return (id: string) => map.get(id) ?? '—'
  }, [lists])

  const filtered = useMemo(() => {
    const q = f.jobsQuery.trim().toLowerCase()
    return (jobs ?? []).filter((job) => {
      if (f.jobsStatus !== 'all' && job.status !== f.jobsStatus) return false
      if (!q) return true
      return job.username.toLowerCase().includes(q) || (job.error ?? '').toLowerCase().includes(q)
    })
  }, [jobs, f.jobsQuery, f.jobsStatus])

  if (jobs === undefined) {
    return <div className="text-muted-foreground animate-pulse p-12 text-center text-sm">Loading jobs...</div>
  }

  if (!jobs.length) {
    return <JobsEmptyState />
  }

  return (
    <div className="space-y-4">
      {!filtered.length ? (
        <div className="border-line-soft bg-panel-subtle rounded-2xl border-2 border-dashed p-12 text-center">
          <p className="text-ink text-sm font-medium">No matching jobs</p>
          <p className="text-subtle-copy mt-1 text-sm">Try a different search term or status filter.</p>
        </div>
      ) : mobile ? (
        <div className="space-y-3">
          {filtered.map((job) => (
            <div key={job._id} className="bg-panel-strong border-line rounded-2xl border p-4 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <a
                  className="brand-link min-w-0 truncate font-medium"
                  href={`https://www.instagram.com/${job.username}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{job.username}
                </a>
                <JobStatusBadge status={job.status} />
              </div>
              <dl className="text-subtle-copy mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt>Leads</dt>
                  <dd className="text-copy">
                    {job.discovered} new · {job.posts?.length ?? 0} posts
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>List</dt>
                  <dd className="text-copy truncate">{listName(job.listId)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Since</dt>
                  <dd className="text-copy">{new Date(job.sinceDate).toLocaleDateString()}</dd>
                </div>
              </dl>
              {job.error && <p className="text-status-danger mt-2 text-xs">{job.error}</p>}
              {['failed', 'paused'].includes(job.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => void retryJob({ jobId: job._id }).catch((e) => toast.error(String(e)))}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs">
          <Table>
            <TableHeader>
              <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
                <TableHead className="text-muted-copy h-12 pl-4 font-medium">Source</TableHead>
                <TableHead className="text-muted-copy h-12 w-[130px] font-medium">Status</TableHead>
                <TableHead className="text-muted-copy h-12 w-[150px] font-medium">Progress</TableHead>
                <TableHead className="text-muted-copy h-12 w-[170px] font-medium">List</TableHead>
                <TableHead className="text-muted-copy h-12 w-[120px] font-medium">Since</TableHead>
                <TableHead className="text-muted-copy h-12 w-[110px] pr-4 text-right font-medium">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((job) => (
                <TableRow key={job._id} className="group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle">
                  <TableCell className="pl-4 font-medium">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <a
                        className="brand-link truncate"
                        href={`https://www.instagram.com/${job.username}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        @{job.username}
                      </a>
                      {job.error && <span className="text-status-danger truncate text-xs font-normal">{job.error}</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="text-copy text-xs whitespace-nowrap">
                    {job.posts?.length ?? 0} posts · {job.discovered} leads
                    <span className="text-subtle-copy"> / max {job.postLimit}</span>
                  </TableCell>
                  <TableCell className="text-muted-copy max-w-[170px] truncate text-xs">{listName(job.listId)}</TableCell>
                  <TableCell className="text-muted-copy text-xs whitespace-nowrap">
                    {new Date(job.sinceDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {['failed', 'paused'].includes(job.status) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-copy hover:bg-panel-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
                        onClick={() => void retryJob({ jobId: job._id }).catch((e) => toast.error(String(e)))}
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry
                      </Button>
                    ) : (
                      <span className="text-subtle-copy/50 text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function JobsEmptyState() {
  return (
    <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
      <Inbox className="text-subtle-copy mb-4 h-10 w-10" />
      <h3 className="text-ink text-lg font-medium">No source jobs yet</h3>
      <p className="text-subtle-copy mt-1 max-w-md text-sm">
        Add Instagram profiles to collect recent post likers. Classified accounts land in your outreach lists.
      </p>
    </div>
  )
}

/* ── Scraping accounts view ── */

function AccountsView() {
  const f = useFilters()
  const accounts = useQuery(api.scraper.accounts, {})
  const mobile = useIsMobile()

  const filtered = useMemo(() => {
    const q = f.accountsQuery.trim().toLowerCase()
    if (!q) return accounts ?? []
    return (accounts ?? []).filter((a) => a.name.toLowerCase().includes(q))
  }, [accounts, f.accountsQuery])

  if (accounts === undefined) {
    return <div className="text-muted-foreground animate-pulse p-12 text-center text-sm">Loading accounts...</div>
  }

  if (!accounts.length) {
    return (
      <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
        <UserCheck className="text-subtle-copy mb-4 h-10 w-10" />
        <h3 className="text-ink text-lg font-medium">No profiles available</h3>
        <p className="text-subtle-copy mt-1 text-sm">Create a profile to start scraping.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!filtered.length ? (
        <div className="border-line-soft bg-panel-subtle rounded-2xl border-2 border-dashed p-12 text-center">
          <p className="text-ink text-sm font-medium">No matching accounts</p>
          <p className="text-subtle-copy mt-1 text-sm">Try a different search term.</p>
        </div>
      ) : mobile ? (
        <div className="space-y-3">
          {filtered.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </div>
      ) : (
        <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs">
          <Table>
            <TableHeader>
              <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
                <TableHead className="text-muted-copy h-12 pl-4 font-medium">Account</TableHead>
                <TableHead className="text-muted-copy h-12 w-[220px] font-medium">Usage today</TableHead>
                <TableHead className="text-muted-copy h-12 w-[150px] font-medium">Status</TableHead>
                <TableHead className="text-muted-copy h-12 w-[220px] pr-4 text-right font-medium">Daily limit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((account) => (
                <AccountDesktopRow key={account.id} account={account} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function accountStatus(account: Account) {
  if (!account.ready) return { label: 'Needs session', className: 'bg-panel-muted text-copy border-line', dot: 'bg-subtle-copy' }
  if (account.cooldownUntil && account.cooldownUntil > Date.now())
    return { label: 'Cooling down', className: 'bg-status-danger-soft text-status-danger border-status-danger-border', dot: 'status-dot-danger' }
  return { label: 'Ready', className: 'bg-status-success-soft text-status-success border-status-success-border', dot: 'status-dot-success-tight' }
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const fill = pct >= 90 ? 'bg-status-danger' : pct >= 70 ? 'bg-status-warning' : 'bg-status-success'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-copy font-medium tabular-nums">
          {used} / {limit}
        </span>
        <span className="text-subtle-copy tabular-nums">{pct}%</span>
      </div>
      <div className="bg-panel-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
        <div className={cn('h-full rounded-full transition-[width]', fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function DailyLimitEditor({ account, compact }: { account: Account; compact?: boolean }) {
  const [limit, setLimit] = useState(String(account.dailyLimit))
  const [busy, setBusy] = useState(false)
  const save = useMutation(api.scraper.setDailyLimit)

  useEffect(() => {
    setLimit(String(account.dailyLimit))
  }, [account.dailyLimit])

  const dirty = Number(limit) !== account.dailyLimit
  const submit = async () => {
    setBusy(true)
    try {
      await save({ profileId: account.id, limit: Number(limit) })
      toast.success('Daily limit saved')
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex items-center gap-2', compact ? 'w-full' : 'justify-end')}>
      <Input
        aria-label={`${account.name} daily limit`}
        type="number"
        min={1}
        max={100000}
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        className="bg-field border-line brand-focus h-8 w-24 shadow-sm"
      />
      <Button size="sm" variant="outline" onClick={() => void submit()} disabled={busy || !dirty} className="h-8">
        Save
      </Button>
    </div>
  )
}

function AccountDesktopRow({ account }: { account: Account }) {
  const status = accountStatus(account)
  return (
    <TableRow className="border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle">
      <TableCell className="pl-4 font-medium">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ink truncate">{account.name}</span>
          {!account.ready && <span className="text-subtle-copy text-xs font-normal">Open profile to capture session</span>}
          {account.ready && account.cooldownUntil && account.cooldownUntil > Date.now() && (
            <span className="text-status-danger text-xs font-normal">
              Instagram 429 · retry after {new Date(account.cooldownUntil).toLocaleTimeString()}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <UsageBar used={account.used} limit={account.dailyLimit} />
      </TableCell>
      <TableCell>
        <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', status.className)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>
      </TableCell>
      <TableCell className="pr-4">
        <DailyLimitEditor account={account} />
      </TableCell>
    </TableRow>
  )
}

function AccountCard({ account }: { account: Account }) {
  const status = accountStatus(account)
  return (
    <div className="bg-panel-strong border-line rounded-2xl border p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-ink truncate text-base font-semibold">{account.name}</h3>
          {!account.ready && <p className="text-subtle-copy mt-0.5 text-xs">Open profile to capture session</p>}
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium', status.className)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>
      </div>
      {account.ready && account.cooldownUntil && account.cooldownUntil > Date.now() && (
        <p className="text-status-danger mt-2 text-xs">
          Instagram 429 · retry after {new Date(account.cooldownUntil).toLocaleTimeString()}
        </p>
      )}
      <div className="mt-3">
        <UsageBar used={account.used} limit={account.dailyLimit} />
      </div>
      <div className="border-line mt-3 border-t pt-3">
        <DailyLimitEditor account={account} compact />
      </div>
    </div>
  )
}

/* ── Saved accounts view ── */

function SavedView() {
  const f = useFilters()
  const [visibleCount, setVisibleCount] = useState(100)
  const {
    results: leads,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(api.leads.listPage, {
    listId: f.savedList === 'all' ? undefined : f.savedList as Id<'leadLists'>,
    classification: f.savedType === 'all' ? undefined : f.savedType as 'male' | 'female' | 'business',
    search: f.savedQuery.trim() || undefined,
  }, { initialNumItems: 100 })

  useEffect(() => {
    setVisibleCount(100)
  }, [f.savedList, f.savedType, f.savedQuery])

  useEffect(() => {
    if (pageStatus === 'CanLoadMore' && leads.length < visibleCount) loadMore(100)
  }, [pageStatus, leads.length, visibleCount, loadMore])

  const fillingPage = leads.length < visibleCount && pageStatus !== 'Exhausted'
  const hasMore = leads.length > visibleCount || pageStatus !== 'Exhausted'

  return (
    <div className="space-y-3">
      <LeadsList
        leads={leads.slice(0, visibleCount)}
        loading={pageStatus === 'LoadingFirstPage' || (pageStatus !== 'Exhausted' && leads.length === 0)}
        hasActiveFilter={!!f.savedQuery || f.savedList !== 'all' || f.savedType !== 'all'}
      />
      {hasMore && (
        <Button variant="outline" disabled={fillingPage} onClick={() => setVisibleCount(count => count + 100)}>
          {fillingPage ? 'Loading accounts...' : 'Load more accounts'}
        </Button>
      )}
    </div>
  )
}

/* ── Lead lists view ── */

type LeadList = { _id: Id<'leadLists'>; name: string; createdAt: number }

function ListsView() {
  const f = useFilters()
  const lists = useQuery(api.leads.lists, {})
  const mobile = useIsMobile()
  const [renameTarget, setRenameTarget] = useState<LeadList | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LeadList | null>(null)

  const filtered = useMemo(() => {
    const q = f.listsQuery.trim().toLowerCase()
    if (!q) return lists ?? []
    return (lists ?? []).filter((l) => l.name.toLowerCase().includes(q))
  }, [lists, f.listsQuery])

  if (lists === undefined) {
    return <div className="text-muted-foreground animate-pulse p-12 text-center text-sm">Loading lists...</div>
  }

  if (!lists.length) {
    return (
      <>
        <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
          <h3 className="text-ink text-lg font-medium">No lead lists yet</h3>
          <p className="text-subtle-copy mt-1 text-sm">Create a list to organize scraped leads.</p>
        </div>
        <LeadListCreateDialog open={f.listCreateOpen} onOpenChange={f.setListCreateOpen} />
      </>
    )
  }

  return (
    <div className="space-y-4">
      {!filtered.length ? (
        <div className="border-line-soft bg-panel-subtle rounded-2xl border-2 border-dashed p-12 text-center">
          <p className="text-ink text-sm font-medium">No matching lists</p>
          <p className="text-subtle-copy mt-1 text-sm">Try a different search term.</p>
        </div>
      ) : mobile ? (
        <div className="space-y-3">
          {filtered.map((list) => (
            <div key={list._id} className="bg-panel-strong border-line rounded-2xl border p-4 shadow-xs">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-ink min-w-0 flex-1 truncate text-base font-semibold">{list.name}</h3>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Rename ${list.name}`}
                    className="text-muted-copy hover:bg-panel-muted h-8 w-8 hover:text-ink"
                    onClick={() => setRenameTarget(list)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${list.name}`}
                    className="text-status-danger hover:bg-status-danger-soft h-8 w-8"
                    onClick={() => setDeleteTarget(list)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-subtle-copy mt-1 text-xs">Created {new Date(list.createdAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs">
          <Table>
            <TableHeader>
              <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
                <TableHead className="text-muted-copy h-12 pl-4 font-medium">Name</TableHead>
                <TableHead className="text-muted-copy h-12 w-[160px] font-medium">Created</TableHead>
                <TableHead className="text-muted-copy h-12 w-[110px] pr-4 text-right font-medium">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((list) => (
                <TableRow key={list._id} className="group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle">
                  <TableCell className="text-ink pl-4 font-medium">{list.name}</TableCell>
                  <TableCell className="text-muted-copy text-xs whitespace-nowrap">
                    {new Date(list.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Rename list"
                        className="text-muted-copy hover:bg-panel-muted h-8 w-8 hover:text-ink"
                        onClick={() => setRenameTarget(list)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete list"
                        className="text-status-danger hover:bg-status-danger-soft h-8 w-8"
                        onClick={() => setDeleteTarget(list)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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

function LeadListCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createList = useMutation(api.leads.createList)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setBusy(false)
    }
  }, [open])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
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
      <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[440px]">
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
            className="bg-field border-line brand-focus"
            autoFocus
          />
        </div>
        <DialogFooter className="shrink-0 gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy} className="button-ghost">
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()} className="brand-button">
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
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (list) {
      setName(list.name)
      setBusy(false)
    }
  }, [list])

  const submit = async () => {
    const trimmed = name.trim()
    if (!list || !trimmed || trimmed === list.name) return
    setBusy(true)
    try {
      await apiFetch('/api/lead-lists/rename', { method: 'POST', body: { listId: list._id, name: trimmed } })
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
      <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[440px]">
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
            className="bg-field border-line brand-focus"
            autoFocus
          />
        </div>
        <DialogFooter className="shrink-0 gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy} className="button-ghost">
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

/* ── New job dialog (popup) ── */

function NewJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const lists = useQuery(api.leads.lists, {})
  const createJobs = useMutation(api.scraper.createJobs)
  const navigate = useNavigate()

  const [links, setLinks] = useState('')
  const [days, setDays] = useState('90')
  const [postLimit, setPostLimit] = useState('10')
  const [targetList, setTargetList] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setLinks('')
      setDays('90')
      setPostLimit('10')
      setBusy(false)
    }
  }, [open ])

  useEffect(() => {
    if (open && lists && !lists.some((list) => list._id === targetList)) {
      setTargetList(lists[0]?._id ?? '')
    }
  }, [open, targetList, lists])

  const daysValue = Number(days)
  const validDays = Number.isSafeInteger(daysValue) && daysValue >= 1 && daysValue <= 3650
  const postLimitValue = Number(postLimit)
  const validPostLimit = Number.isSafeInteger(postLimitValue) && postLimitValue >= 1 && postLimitValue <= 5000
  const parsedCount = splitLinks(links).length
  const canSubmit = !busy && parsedCount > 0 && !!lists?.some((list) => list._id === targetList) && validDays && validPostLimit

  const addSources = async () => {
    setBusy(true)
    try {
      const result = await createJobs({
        links: splitLinks(links),
        listId: targetList as Id<'leadLists'>,
        lookbackDays: daysValue,
        postLimit: postLimitValue,
      })
      setLinks('')
      onOpenChange(false)
      navigate('/scraper?tab=jobs')
      toast.success(
        `${result.created} profile${result.created === 1 ? '' : 's'} queued${result.duplicates ? `, ${result.duplicates} already queued` : ''}`,
      )
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[560px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="page-title-gradient">New scraping job</DialogTitle>
        </DialogHeader>

        <div className="grid flex-1 gap-4 overflow-y-auto py-1">
          <div className="grid gap-2">
            <Label htmlFor="scraper-links">Instagram profile links or usernames</Label>
            <Textarea
              id="scraper-links"
              value={links}
              onChange={(e) => setLinks(e.target.value)}
              placeholder="https://www.instagram.com/example/&#10;@another_profile"
              rows={4}
              className="bg-field border-line brand-focus mt-1 min-h-24"
            />
            {parsedCount > 0 && (
              <p className="text-subtle-copy text-xs">
                {parsedCount} profile{parsedCount === 1 ? '' : 's'} detected
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="scraper-days">Posts from the last (days)</Label>
              <Input
                id="scraper-days"
                type="number"
                min={1}
                max={3650}
                step={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="bg-field border-line brand-focus"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="scraper-post-limit">Max posts per profile</Label>
              <Input
                id="scraper-post-limit"
                type="number"
                min={1}
                max={5000}
                step={1}
                value={postLimit}
                onChange={(e) => setPostLimit(e.target.value)}
                className="bg-field border-line brand-focus"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Target lead list</Label>
            <Select value={targetList} onValueChange={setTargetList}>
              <SelectTrigger className="bg-field border-line w-full">
                <SelectValue placeholder="Choose a list" />
              </SelectTrigger>
              <SelectContent className="panel-dropdown">
                {lists?.map((list) => (
                  <SelectItem key={list._id} value={list._id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy} className="button-ghost">
            Cancel
          </Button>
          <Button onClick={() => void addSources()} disabled={!canSubmit} className="brand-button">
            {busy ? 'Queueing...' : parsedCount > 0 ? `Add ${parsedCount} to scraper` : 'Add to scraper'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
