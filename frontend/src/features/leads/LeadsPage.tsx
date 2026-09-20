import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { ListPlus, Search, Upload, X } from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
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
import { cn } from '@/lib/utils'
import { LeadsList, LEAD_STATUS_META } from './components/LeadsList'
import { LeadImportDialog } from './components/LeadImportDialog'

const STATUS_ORDER = [
  'new',
  'ready',
  'reserved',
  'uncertain',
  'contacted',
  'replied',
  'do_not_contact',
] as const

type BulkStatus = 'ready' | 'contacted' | 'replied' | 'do_not_contact'

const BULK_ACTIONS: { status: BulkStatus; label: string }[] = [
  { status: 'ready', label: 'Mark Ready' },
  { status: 'contacted', label: 'Confirm contacted' },
  { status: 'replied', label: 'Mark replied' },
  { status: 'do_not_contact', label: 'Do not contact' },
]

export function LeadsPage() {
  const lists = useQuery(api.leads.lists, {})
  const [listFilter, setListFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selected, setSelected] = useState<Id<'leads'>[]>([])
  const [busy, setBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [newListOpen, setNewListOpen] = useState(false)
  const [newListName, setNewListName] = useState('')

  const listId = listFilter === 'all' ? undefined : (listFilter as Id<'leadLists'>)
  const leads = useQuery(api.leads.list, { listId })
  const createList = useMutation(api.leads.createList)
  const setStatus = useMutation(api.leads.setStatus)

  const clearSelection = () => setSelected([])

  // Search applies to username, source, and sender name.
  const searched = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return leads ?? []
    return (leads ?? []).filter((l) =>
      [l.username, l.source, l.senderName ?? ''].some((f) =>
        String(f).toLowerCase().includes(q),
      ),
    )
  }, [leads, searchQuery])

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of searched) counts.set(l.status, (counts.get(l.status) ?? 0) + 1)
    return counts
  }, [searched])

  const visible = useMemo(
    () =>
      statusFilter === 'all'
        ? searched
        : searched.filter((l) => l.status === statusFilter),
    [searched, statusFilter],
  )

  const hasActiveFilter =
    searchQuery.trim() !== '' || statusFilter !== 'all' || listFilter !== 'all'

  const toggleSelect = (id: Id<'leads'>) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id],
    )

  const toggleSelectAll = () => {
    const visibleIds = visible.map((l) => l._id)
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
    setSelected((ids) =>
      allSelected
        ? ids.filter((id) => !visibleIds.includes(id))
        : [...new Set([...ids, ...visibleIds])],
    )
  }

  const selectedLeads = useMemo(
    () => (leads ?? []).filter((l) => selected.includes(l._id)),
    [leads, selected],
  )
  // The backend rejects queueing previously contacted leads, so only offer
  // Mark Ready when every selected lead is still new (or already ready).
  const canMarkReady =
    selectedLeads.length > 0 &&
    selectedLeads.every((l) => ['new', 'ready'].includes(l.status))

  const runBulk = (status: BulkStatus) => {
    setBusy(true)
    void (async () => {
      try {
        await setStatus({ ids: selected, status })
        clearSelection()
      } catch (e) {
        toast.error(String(e))
      } finally {
        setBusy(false)
      }
    })()
  }

  const handleCreateList = () => {
    const name = newListName.trim()
    if (!name) return
    setBusy(true)
    void (async () => {
      try {
        const id = await createList({ name })
        setListFilter(id)
        setStatusFilter('all')
        clearSelection()
        setNewListName('')
        setNewListOpen(false)
        toast.success(`List "${name}" created`)
      } catch (e) {
        toast.error(String(e))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <LeadsHeader
        searchQuery={searchQuery}
        onSearchChange={(v) => {
          setSearchQuery(v)
          clearSelection()
        }}
        listFilter={listFilter}
        onListFilterChange={(v) => {
          setListFilter(v)
          clearSelection()
        }}
        listNames={lists?.map((l) => ({ id: l._id, name: l.name })) ?? []}
        onImport={() => setImportOpen(true)}
        onNewList={() => {
          setNewListName('')
          setNewListOpen(true)
        }}
        loading={leads === undefined}
        busy={busy}
      />

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px] space-y-4">
          <StatusFilterChips
            counts={statusCounts}
            total={searched.length}
            active={statusFilter}
            onChange={(v) => {
              setStatusFilter(v)
              clearSelection()
            }}
          />

          {selected.length > 0 && (
            <BulkActionBar
              count={selected.length}
              busy={busy}
              canMarkReady={canMarkReady}
              onAction={runBulk}
              onClear={clearSelection}
            />
          )}

          <LeadsList
            leads={visible}
            loading={leads === undefined}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            hasActiveFilter={hasActiveFilter}
          />
        </div>
      </div>

      <LeadImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        lists={lists}
        defaultListId={listId}
        onImported={clearSelection}
      />

      <Dialog open={newListOpen} onOpenChange={setNewListOpen}>
        <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[440px]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="page-title-gradient">New lead list</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-1">
            <Label htmlFor="new-lead-list-name">List name</Label>
            <Input
              id="new-lead-list-name"
              placeholder="e.g. Downtown gyms"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateList()
              }}
              className="bg-field border-line"
              autoFocus
            />
          </div>
          <DialogFooter className="shrink-0 gap-2">
            <Button
              variant="ghost"
              onClick={() => setNewListOpen(false)}
              disabled={busy}
              className="button-ghost"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateList}
              disabled={busy || !newListName.trim()}
              className="brand-button"
            >
              Create list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ── Header ── */

function LeadsHeader({
  searchQuery,
  onSearchChange,
  listFilter,
  onListFilterChange,
  listNames,
  onImport,
  onNewList,
  loading,
  busy,
}: {
  searchQuery: string
  onSearchChange: (value: string) => void
  listFilter: string
  onListFilterChange: (value: string) => void
  listNames: { id: string; name: string }[]
  onImport: () => void
  onNewList: () => void
  loading: boolean
  busy: boolean
}) {
  return (
    <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-grow flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
            <Input
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search username, source, sender..."
              className="bg-field border border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pl-9 text-sm leading-5 font-normal shadow-sm"
            />
          </div>
          <Select value={listFilter} onValueChange={onListFilterChange}>
            <SelectTrigger
              aria-label="Lead list"
              className="bg-field border-line h-8 w-full text-sm shadow-sm sm:w-[220px]"
            >
              <SelectValue placeholder="All lead lists" />
            </SelectTrigger>
            <SelectContent className="panel-dropdown">
              <SelectItem value="all">All lead lists</SelectItem>
              {listNames.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={onNewList}
            disabled={loading || busy}
            className="h-8 font-medium"
          >
            <ListPlus className="mr-2 h-3.5 w-3.5" /> New List
          </Button>
          <Button
            size="sm"
            onClick={onImport}
            disabled={loading || busy}
            className="mobile-effect-shadow brand-button h-8 font-medium"
          >
            <Upload className="mr-2 h-3.5 w-3.5" /> Import
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Status filter chips ── */

function StatusFilterChips({
  counts,
  total,
  active,
  onChange,
}: {
  counts: Map<string, number>
  total: number
  active: string
  onChange: (status: string) => void
}) {
  if (total === 0) return null
  const visibleStatuses = STATUS_ORDER.filter((s) => counts.has(s))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterChip
        active={active === 'all'}
        onClick={() => onChange('all')}
        label="All"
        count={total}
      />
      {visibleStatuses.map((status) => (
        <FilterChip
          key={status}
          active={active === status}
          onClick={() => onChange(status)}
          label={
            LEAD_STATUS_META[status]?.label ?? status.replaceAll('_', ' ')
          }
          count={counts.get(status) ?? 0}
        />
      ))}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-line-strong bg-panel-selected text-ink'
          : 'border-line text-muted-copy hover:border-line-strong hover:text-ink',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none',
          active ? 'bg-panel-muted text-ink' : 'bg-panel-muted text-muted-copy',
        )}
      >
        {count}
      </span>
    </button>
  )
}

/* ── Bulk action bar ── */

function BulkActionBar({
  count,
  busy,
  canMarkReady,
  onAction,
  onClear,
}: {
  count: number
  busy: boolean
  canMarkReady: boolean
  onAction: (status: BulkStatus) => void
  onClear: () => void
}) {
  return (
    <div className="bg-panel-strong border-line flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-2.5 shadow-xs">
      <span className="text-copy text-sm font-medium">
        {count} selected
      </span>
      <div className="bg-line-soft h-5 w-px shrink-0" />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => onAction('ready')}
          disabled={busy || !canMarkReady}
          title={
            canMarkReady
              ? 'Queue selected leads for outreach'
              : 'Only new leads can be marked Ready'
          }
          className="brand-button h-8"
        >
          Mark Ready
        </Button>
        {BULK_ACTIONS.slice(1).map(({ status, label }) => (
          <Button
            key={status}
            size="sm"
            variant="outline"
            onClick={() => onAction(status)}
            disabled={busy}
            className={cn(
              'h-8',
              status === 'do_not_contact' &&
                'text-status-danger hover:text-status-danger hover:bg-status-danger-soft border-status-danger-border',
            )}
          >
            {label}
          </Button>
        ))}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        disabled={busy}
        className="button-ghost ml-auto h-8"
      >
        <X className="mr-1 h-3.5 w-3.5" /> Clear
      </Button>
    </div>
  )
}
