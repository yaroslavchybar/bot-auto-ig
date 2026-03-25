import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api } from '../../../../../convex/_generated/api'
import { cn } from '@/lib/utils'
import { RefreshCw, Search, Users, X } from 'lucide-react'
import type { List, ProfileRow } from '../types'

interface ListsFormProps {
  mode: 'create' | 'edit'
  initialData?: List
  saving: boolean
  error?: string | null
  onSave: (name: string, addedIds: string[], removedIds: string[]) => void
  onCancel: () => void
  className?: string
}

export function ListsForm(props: ListsFormProps) {
  if (props.mode === 'create') return <ListsCreateForm {...props} />
  return <ListsEditForm {...props} />
}

/* ── Create Form ── */

function ListsCreateForm({
  saving,
  error: externalError,
  onSave,
  onCancel,
  className,
}: ListsFormProps) {
  const [name, setName] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const error = externalError || localError

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) { setLocalError('Name is required'); return }
    setLocalError(null)
    onSave(trimmed, [], [])
  }

  return (
    <div className={cn('flex flex-col p-6', className)}>
      <div className="grid gap-5 pb-6">
        <div className="grid gap-1.5">
          <Label htmlFor="name" className="text-muted-copy text-xs font-semibold tracking-wider uppercase">
            List Name
          </Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)}
            disabled={saving} placeholder="Enter list name..." autoFocus
            className="brand-focus bg-field border-line h-10 font-medium text-ink" />
        </div>
      </div>
      <FormFooter error={error} saving={saving} onCancel={onCancel}
        onSubmit={handleSubmit} label="Create List" />
    </div>
  )
}

/* ── Edit Form ── */

/* ── Edit form state hook ── */

function useListEditState(initialData: List | undefined, saving: boolean) {
  const [name, setName] = useState(initialData?.name || '')
  const [selectionOverrides, setSelectionOverrides] = useState<Record<string, boolean>>({})
  const [localError, setLocalError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const liveProfiles = useQuery(api.profiles.queries.list, {})
  const loadingProfiles = Boolean(initialData) && liveProfiles === undefined
  const profiles = useProfileRows(initialData, liveProfiles, selectionOverrides)

  const handleToggle = (profileId: string) => {
    if (saving) return
    const current = profiles.find((p) => p.profile_id === profileId)
    if (!current) return
    setSelectionOverrides((prev) => ({ ...prev, [profileId]: !current.selected }))
  }

  const filteredProfiles = useMemo(
    () => profiles.filter((p) => {
      const q = searchQuery.trim().toLowerCase()
      if (!q) return true
      return p.name.toLowerCase().includes(q) || p.profile_id.toLowerCase().includes(q)
    }),
    [profiles, searchQuery],
  )

  const selectedProfiles = useMemo(() => profiles.filter((p) => p.selected), [profiles])
  const changedCount = useMemo(
    () => profiles.filter((p) => p.selected !== p.initialSelected).length,
    [profiles],
  )

  const setFilteredSelection = (nextSelected: boolean) => {
    if (saving || loadingProfiles) return
    const q = searchQuery.trim().toLowerCase()
    setSelectionOverrides((prev) => {
      const next = { ...prev }
      profiles.forEach((p) => {
        if (!q || p.name.toLowerCase().includes(q) || p.profile_id.toLowerCase().includes(q)) {
          next[p.profile_id] = nextSelected
        }
      })
      return next
    })
  }

  const filteredSelectionState = useMemo(() => {
    if (filteredProfiles.length === 0) return false as const
    const checked = filteredProfiles.filter((p) => p.selected).length
    if (checked === 0) return false as const
    if (checked === filteredProfiles.length) return true as const
    return 'indeterminate' as const
  }, [filteredProfiles])

  return {
    name, setName, localError, setLocalError,
    searchQuery, setSearchQuery, loadingProfiles, profiles,
    filteredProfiles, selectedProfiles, changedCount,
    filteredSelectionState, handleToggle, setFilteredSelection,
  }
}

function ListsEditForm({
  initialData, saving, error: externalError, onSave, onCancel, className,
}: ListsFormProps) {
  const state = useListEditState(initialData, saving)
  const error = externalError || state.localError

  const handleSubmit = () => {
    const trimmed = state.name.trim()
    if (!trimmed) { state.setLocalError('Name is required'); return }
    const addedIds = state.profiles.filter((p) => p.selected && !p.initialSelected).map((p) => p.profile_id)
    const removedIds = state.profiles.filter((p) => !p.selected && p.initialSelected).map((p) => p.profile_id)
    state.setLocalError(null)
    onSave(trimmed, addedIds, removedIds)
  }

  return (
    <div className={cn('flex h-[min(82vh,720px)] flex-col', className)}>
      <EditFormHeader name={state.name} onNameChange={state.setName} saving={saving} changedCount={state.changedCount} />
      <div className="flex-1 overflow-hidden px-6 pt-4 pb-4">
        <div className="flex h-full flex-col gap-4">
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <ProfileSelectionList
              profiles={state.profiles} filteredProfiles={state.filteredProfiles}
              loadingProfiles={state.loadingProfiles} saving={saving}
              searchQuery={state.searchQuery} filteredSelectionState={state.filteredSelectionState}
              onSearchChange={state.setSearchQuery} onToggle={state.handleToggle}
              onSetFilteredSelection={state.setFilteredSelection}
            />
            <SelectedProfilesSidebar
              selectedProfiles={state.selectedProfiles} saving={saving} onToggle={state.handleToggle}
            />
          </div>
        </div>
      </div>
      <div className="border-line-soft bg-panel border-t px-6 py-4">
        <FormFooter error={error} saving={saving} onCancel={onCancel} onSubmit={handleSubmit} label="Save Changes" />
      </div>
    </div>
  )
}

/* ── Hooks ── */

function useProfileRows(
  initialData: List | undefined,
  liveProfiles: Array<{ _id: unknown; name: unknown; login: unknown; listIds?: unknown[] }> | undefined,
  selectionOverrides: Record<string, boolean>,
): ProfileRow[] {
  return useMemo(() => {
    if (!initialData || !liveProfiles) return []
    return liveProfiles
      .filter((p) => Boolean(p?.login))
      .map((p) => {
        const id = String(p._id ?? '')
        const listIds = Array.isArray(p.listIds)
          ? p.listIds.map((lid) => String(lid || '')).filter(Boolean) : []
        const selected = listIds.includes(initialData.id)
        return {
          profile_id: id,
          name: String(p.name || ''),
          selected: selectionOverrides[id] ?? selected,
          initialSelected: selected,
        }
      })
      .filter((row) => Boolean(row.profile_id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [initialData, liveProfiles, selectionOverrides])
}

/* ── Sub-components ── */

function EditFormHeader({ name, onNameChange, saving, changedCount }: {
  name: string; onNameChange: (v: string) => void; saving: boolean; changedCount: number
}) {
  return (
    <div className="border-line-soft flex items-center justify-between gap-4 border-b px-6 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-6">
        <DialogTitle className="text-ink shrink-0 text-xl font-semibold tracking-tight">
          Edit List
        </DialogTitle>
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-md">
          <Input id="name" value={name} onChange={(e) => onNameChange(e.target.value)}
            disabled={saving} placeholder="List name..." autoFocus
            className="brand-focus border-line bg-panel-subtle text-ink h-9 w-full rounded-lg border px-3 text-sm font-medium" />
          {changedCount > 0 && (
            <span className="brand-surface brand-text-soft shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase">
              {changedCount} pending change{changedCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <DialogClose asChild>
        <button type="button" aria-label="Close modal"
          className="button-neutral inline-flex h-8 w-8 items-center justify-center rounded-full">
          <X className="h-4 w-4" />
        </button>
      </DialogClose>
    </div>
  )
}

function ProfileSelectionList({ profiles, filteredProfiles, loadingProfiles, saving,
  searchQuery, filteredSelectionState, onSearchChange, onToggle, onSetFilteredSelection,
}: {
  profiles: ProfileRow[]; filteredProfiles: ProfileRow[]
  loadingProfiles: boolean; saving: boolean; searchQuery: string
  filteredSelectionState: boolean | 'indeterminate'
  onSearchChange: (v: string) => void; onToggle: (id: string) => void
  onSetFilteredSelection: (v: boolean) => void
}) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="mb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
          <Input placeholder="Search profiles..." value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="bg-field border border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pl-9 text-sm font-normal leading-5 shadow-sm"
            disabled={loadingProfiles || saving} />
        </div>
      </div>
      <div className="border-line bg-panel-soft flex items-center rounded-t-[18px] border border-b-0 px-3.5 py-2.5">
        <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium text-ink hover:text-ink/80 transition-colors">
          <Checkbox checked={filteredSelectionState}
            onCheckedChange={(checked) => onSetFilteredSelection(checked === true)}
            disabled={loadingProfiles || saving || filteredProfiles.length === 0}
            className="brand-checkbox border-line-strong bg-field-alt h-4.5 w-4.5" />
          <span>{filteredSelectionState === true ? 'Deselect All' : 'Select All'}</span>
        </label>
      </div>
      <ProfileListBody profiles={profiles} filteredProfiles={filteredProfiles}
        loadingProfiles={loadingProfiles} onToggle={onToggle} />
    </section>
  )
}

function ProfileListBody({ profiles, filteredProfiles, loadingProfiles, onToggle }: {
  profiles: ProfileRow[]; filteredProfiles: ProfileRow[]
  loadingProfiles: boolean; onToggle: (id: string) => void
}) {
  if (loadingProfiles) {
    return (
      <div className="border-line bg-panel-subtle min-h-0 flex-1 overflow-hidden rounded-b-[18px] border">
        <div className="text-subtle-copy flex h-full items-center justify-center text-xs">
          <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading profiles...
        </div>
      </div>
    )
  }
  if (profiles.length === 0) {
    return (
      <div className="border-line bg-panel-subtle min-h-0 flex-1 overflow-hidden rounded-b-[18px] border">
        <div className="text-subtle-copy flex h-full flex-col items-center justify-center px-6 text-center text-xs">
          <Users className="text-dim-copy mb-2 h-5 w-5" /> No profiles available in registry.
        </div>
      </div>
    )
  }
  if (filteredProfiles.length === 0) {
    return (
      <div className="border-line bg-panel-subtle min-h-0 flex-1 overflow-hidden rounded-b-[18px] border">
        <div className="text-subtle-copy flex h-full items-center justify-center px-6 text-center text-xs">
          No matching profiles found.
        </div>
      </div>
    )
  }
  return (
    <div className="border-line bg-panel-subtle min-h-0 flex-1 overflow-hidden rounded-b-[18px] border">
      <ScrollArea className="h-full">
        <div className="flex flex-col">
          {filteredProfiles.map((profile, index) => (
            <button key={profile.profile_id} type="button"
              onClick={() => onToggle(profile.profile_id)}
              className={cn(
                'button-panel flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left',
                index < filteredProfiles.length - 1 && 'border-line border-b',
                profile.selected ? 'bg-panel-selected' : 'hover:bg-panel-subtle',
              )}>
              <Checkbox checked={profile.selected} onCheckedChange={() => undefined}
                className="brand-checkbox border-line-strong bg-field-alt pointer-events-none mt-0.5 h-4.5 w-4.5" />
              <div className="min-w-0 flex-1">
                <p className="text-ink truncate text-xs font-medium">{profile.name}</p>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

function SelectedProfilesSidebar({ selectedProfiles, saving, onToggle }: {
  selectedProfiles: ProfileRow[]; saving: boolean; onToggle: (id: string) => void
}) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="border-line bg-panel-subtle min-h-0 flex-1 rounded-[18px] border p-1">
        {selectedProfiles.length === 0 ? (
          <div className="text-subtle-copy flex h-full min-h-[180px] flex-col items-center justify-center px-6 text-center text-sm">
            <Users className="text-dim-copy mb-3 h-8 w-8" /> No profiles selected.
            <p className="text-dim-copy mt-1 max-w-[200px] text-xs">
              Select profiles from the list on the left to add them here.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="space-y-2.5 p-2.5">
              {selectedProfiles.map((profile) => (
                <div key={profile.profile_id}
                  className="border-line bg-panel-muted flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate text-[13px] font-medium leading-tight">{profile.name}</p>
                  </div>
                  <button type="button" onClick={() => onToggle(profile.profile_id)} disabled={saving}
                    className="button-ghost -mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    aria-label={`Remove ${profile.name}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </section>
  )
}

function FormFooter({ error, saving, onCancel, onSubmit, label }: {
  error: string | null | undefined; saving: boolean
  onCancel: () => void; onSubmit: () => void; label: string
}) {
  return (
    <>
      {error && (
        <div className="text-status-danger bg-status-danger-soft border-status-danger-border mb-4 rounded-md border p-3 text-sm font-medium">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={onSubmit} disabled={saving} className="font-medium">
          {saving ? 'Saving...' : label}
        </Button>
      </div>
    </>
  )
}
