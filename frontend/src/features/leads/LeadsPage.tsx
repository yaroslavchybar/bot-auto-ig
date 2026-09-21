import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { ListPlus, Search, Upload } from 'lucide-react'
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
import { LeadsList } from './components/LeadsList'
import { LeadImportDialog } from './components/LeadImportDialog'

export function LeadsPage() {
  const lists = useQuery(api.leads.lists, {})
  const [listFilter, setListFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [newListOpen, setNewListOpen] = useState(false)
  const [newListName, setNewListName] = useState('')

  const listId = listFilter === 'all' ? undefined : (listFilter as Id<'leadLists'>)
  const leads = useQuery(api.leads.list, { listId })
  const createList = useMutation(api.leads.createList)


  // Search applies to username and sender name.
  const searched = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return leads ?? []
    return (leads ?? []).filter((l) =>
      [l.username, l.senderName ?? ''].some((f) =>
        String(f).toLowerCase().includes(q),
      ),
    )
  }, [leads, searchQuery])

  const hasActiveFilter = searchQuery.trim() !== '' || listFilter !== 'all'

  const handleCreateList = () => {
    const name = newListName.trim()
    if (!name) return
    setBusy(true)
    void (async () => {
      try {
        const id = await createList({ name })
        setListFilter(id)
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
        onSearchChange={setSearchQuery}
        listFilter={listFilter}
        onListFilterChange={setListFilter}
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
          <LeadsList
            leads={searched}
            loading={leads === undefined}
            hasActiveFilter={hasActiveFilter}
          />
        </div>
      </div>

      <LeadImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        lists={lists}
        defaultListId={listId}
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
              placeholder="Search username, sender..."
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
