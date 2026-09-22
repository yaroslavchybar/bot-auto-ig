import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { Button } from '@/components/ui/button'
import { DialogClose } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api } from '../../../../../convex/_generated/api'
import { cn } from '@/lib/utils'
import { Check, Plus, Search, X } from 'lucide-react'
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

function ListsCreateForm({ saving, error, onSave, onCancel, className }: ListsFormProps) {
  const [name, setName] = useState('')
  const trimmed = name.trim()

  return (
    <div className={cn('flex flex-col gap-4 p-6', className)}>
      <Input value={name} onChange={(e) => setName(e.target.value)}
        disabled={saving} placeholder="List name" autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter' && trimmed) onSave(trimmed, [], []) }}
        className="brand-focus bg-field border-line h-10 text-ink" />
      {error && <p className="text-status-danger text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="lg" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="lg" onClick={() => trimmed && onSave(trimmed, [], [])} disabled={saving || !trimmed}>
          Create
        </Button>
      </div>
    </div>
  )
}

type LiveProfile = { _id: unknown; name: unknown; listIds?: unknown[] }
type EditableRow = ProfileRow & { elsewhere: boolean }

function useListEditState(initialData: List | undefined, saving: boolean) {
  const initialName = initialData?.name ?? ''
  const [name, setName] = useState(initialName)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const liveProfiles = useQuery(api.profiles.queries.list, {}) as LiveProfile[] | undefined
  const loading = Boolean(initialData) && liveProfiles === undefined

  const profiles = useMemo<EditableRow[]>(() => {
    if (!initialData || !liveProfiles) return []
    return liveProfiles
      .map((p) => {
        const id = String(p._id ?? '')
        const listIds = Array.isArray(p.listIds) ? p.listIds.map(String) : []
        const selected = listIds.includes(initialData.id)
        return {
          id,
          name: String(p.name || ''),
          selected: overrides[id] ?? selected,
          initialSelected: selected,
          elsewhere: listIds.some((lid) => lid !== initialData.id) && !selected,
        }
      })
      .filter((r) => r.id)
      // Hide profiles that live in another list.
      .filter((r) => !r.elsewhere || r.selected)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }, [initialData, liveProfiles, overrides])

  // Only disambiguate names that actually collide.
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>()
    profiles.forEach((p) => counts.set(p.name, (counts.get(p.name) ?? 0) + 1))
    return counts
  }, [profiles])

  const toggle = (id: string) => {
    if (saving) return
    const row = profiles.find((p) => p.id === id)
    if (!row) return
    setOverrides((prev) => ({ ...prev, [id]: !row.selected }))
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter((p) => p.name.toLowerCase().includes(q))
  }, [profiles, search])

  const selected = useMemo(() => profiles.filter((p) => p.selected), [profiles])
  const added = profiles.filter((p) => p.selected && !p.initialSelected).length
  const removed = profiles.filter((p) => !p.selected && p.initialSelected).length
  const isDirty = name.trim() !== initialName.trim() || added + removed > 0

  const addVisible = () => {
    if (saving || loading) return
    setOverrides((prev) => {
      const out = { ...prev }
      filtered.forEach((p) => { out[p.id] = true })
      return out
    })
  }

  const visibleUnselected = filtered.filter((p) => !p.selected).length

  return {
    name, setName, search, setSearch, loading,
    profiles, filtered, selected, added, removed, isDirty,
    duplicateNames, toggle, addVisible, visibleUnselected,
    setOverrides,
  }
}

function shortId(id: string) {
  return id.slice(-4)
}

function ListsEditForm({ initialData, saving, error, onSave, onCancel, className }: ListsFormProps) {
  const s = useListEditState(initialData, saving)

  const save = () => {
    const name = s.name.trim()
    if (!name || saving) return
    onSave(
      name,
      s.profiles.filter((p) => p.selected && !p.initialSelected).map((p) => p.id),
      s.profiles.filter((p) => !p.selected && p.initialSelected).map((p) => p.id),
    )
  }

  const saveLabel = !s.isDirty
    ? 'Save'
    : s.added + s.removed > 0
      ? `Save · +${s.added} −${s.removed}`
      : 'Save'

  const addFirstOnEnter = () => {
    const first = s.filtered.find((p) => !p.selected)
    if (first) s.toggle(first.id)
  }

  return (
    <div className={cn('flex h-[min(80vh,640px)] flex-col', className)}>
      {/* Name doubles as the title — no separate heading needed. */}
      <div className="flex items-center gap-2 px-5 pt-4 sm:px-6">
        <Input value={s.name} onChange={(e) => s.setName(e.target.value)}
          disabled={saving} placeholder="List name" aria-label="List name"
          className="brand-focus border-transparent bg-transparent text-ink h-9 rounded-lg px-2 -ml-2 text-lg font-semibold hover:border-line focus:bg-field focus:border-line" />
        <DialogClose asChild>
          <button type="button" aria-label="Close"
            className="button-ghost inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            <X className="h-4 w-4" />
          </button>
        </DialogClose>
      </div>

      {/* Selected pills — hidden when empty, compact when present. */}
      {s.selected.length > 0 && (
        <div className="px-5 pt-2 sm:px-6">
          <div className="flex max-h-[92px] flex-wrap gap-1.5 overflow-y-auto">
            {s.selected.map((p) => (
              <button key={p.id} type="button" onClick={() => s.toggle(p.id)} disabled={saving}
                title={p.name}
                className="border-line bg-panel-strong text-ink hover:border-line-strong inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-2.5 text-xs">
                <span className="truncate">
                  {p.name}
                  {(s.duplicateNames.get(p.name) ?? 0) > 1 && (
                    <span className="text-dim-copy font-mono"> ·{shortId(p.id)}</span>
                  )}
                </span>
                <X className="text-muted-copy h-3 w-3 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 px-5 pt-3 sm:px-6">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-copy pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input value={s.search} onChange={(e) => s.setSearch(e.target.value)}
            placeholder="Search or press Enter to add first match" disabled={s.loading || saving}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') addFirstOnEnter() }}
            className="bg-field border-line brand-focus h-9 rounded-lg pr-8 pl-9" />
          {s.search && (
            <button type="button" aria-label="Clear search" onClick={() => s.setSearch('')}
              className="button-ghost absolute top-1/2 right-1.5 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {s.visibleUnselected > 0 && (
          <button type="button" onClick={s.addVisible} disabled={saving}
            className="button-ghost text-ink shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium">
            Add all{ s.search.trim() ? ` (${s.visibleUnselected})` : ''}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 px-3 pt-2 pb-2 sm:px-4">
        {s.loading ? (
          <p className="text-subtle-copy p-8 text-center text-sm">Loading...</p>
        ) : s.filtered.length === 0 ? (
          <p className="text-subtle-copy p-8 text-center text-sm">No profiles found</p>
        ) : (
          <ScrollArea className="h-full">
            <ul className="px-2 py-1">
              {s.filtered.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => s.toggle(p.id)}
                    aria-pressed={p.selected}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                      p.selected ? 'bg-panel-selected' : 'hover:bg-panel-hover',
                    )}>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      <span className={cn(p.selected ? 'text-ink font-medium' : 'text-copy')}>{p.name}</span>
                      {(s.duplicateNames.get(p.name) ?? 0) > 1 && (
                        <span className="text-dim-copy font-mono text-[11px]"> ·{shortId(p.id)}</span>
                      )}
                    </span>
                    <span className={cn(
                      'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                      p.selected
                        ? 'border-transparent bg-status-success-soft text-status-success'
                        : 'border-line text-muted-copy',
                    )}>
                      {p.selected ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      <div className="border-line-soft border-t px-5 py-3 sm:px-6">
        {error && <p className="text-status-danger mb-2 text-sm">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-subtle-copy text-xs tabular-nums">
            {s.selected.length} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="lg" onClick={onCancel} disabled={saving}>Cancel</Button>
            <Button size="lg" onClick={save} disabled={saving || !s.isDirty || !s.name.trim()} className="min-w-[110px]">
              {saving ? 'Saving...' : saveLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
