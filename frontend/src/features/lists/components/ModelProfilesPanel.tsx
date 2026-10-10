import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Loader2, Minus, Plus, Search, UserRound } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { List } from '../types'

type ProfileOption = FunctionReturnType<typeof api.profiles.queries.modelOptions>[number]
type MoveAction = 'add' | 'remove'

// Two-column transfer list: connected profiles on the left, unassigned profiles on the right.
// Each side multi-selects rows and moves them in one bulk mutation.
export function ModelProfilesPanel({ model, active = true }: { model: List; active?: boolean }) {
  const profiles = useQuery(api.profiles.queries.modelOptions, active ? {} : 'skip')
  const add = useMutation(api.profiles.mutations.bulkAddToList)
  const remove = useMutation(api.profiles.mutations.bulkRemoveFromList)
  const [pendingAction, setPendingAction] = useState<MoveAction | null>(null)
  const [error, setError] = useState('')
  const modelId = model.id as Id<'lists'>
  const connected = (profiles ?? [])
    .filter((profile) => profile.listIds?.includes(modelId))
    .sort(byName)
  const available = (profiles ?? [])
    .filter((profile) => !profile.listIds?.length && profile.status !== 'deleting')
    .sort(byName)
  const notLoggedInCount = connected.filter((profile) => !profile.igLoggedIn).length

  // Runs one bulk move. Resolves true on success so the column can clear its selection.
  async function move(profileIds: Id<'profiles'>[], action: MoveAction) {
    if (pendingAction) return false
    setPendingAction(action)
    setError('')
    try {
      const args = { profileIds, listId: modelId }
      if (action === 'add') await add(args)
      else await remove(args)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5 sm:p-6 md:overflow-hidden">
      <p className="text-sm text-subtle-copy">
        Each profile belongs to one model. Select profiles to add or remove them from {model.name}.
      </p>
      {error && (
        <p role="alert" className="text-sm text-status-danger">
          {error}
        </p>
      )}
      {profiles === undefined ? (
        <p className="py-8 text-center text-sm text-subtle-copy">Loading profiles...</p>
      ) : (
        <div className="grid gap-4 md:min-h-0 md:flex-1 md:grid-cols-2">
          <ProfileColumn
            title="Connected"
            profiles={connected}
            action="remove"
            emptyText="No profiles assigned yet. Add some from Available."
            notice={notLoggedInCount > 0 ? `${notLoggedInCount} not logged in` : undefined}
            pendingAction={pendingAction}
            onMove={move}
          />
          <ProfileColumn
            title="Available"
            profiles={available}
            action="add"
            emptyText="Every profile already belongs to a model."
            pendingAction={pendingAction}
            onMove={move}
          />
        </div>
      )}
    </div>
  )
}

// One side of the transfer: a searchable multi-select list with a bulk action footer.
// Selection is cleared when the search changes so the action never hits hidden rows.
function ProfileColumn({
  title,
  profiles,
  action,
  emptyText,
  notice,
  pendingAction,
  onMove,
}: {
  title: string
  profiles: ProfileOption[]
  action: MoveAction
  emptyText: string
  notice?: string
  pendingAction: MoveAction | null
  onMove: (profileIds: Id<'profiles'>[], action: MoveAction) => Promise<boolean>
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<Id<'profiles'>>>(() => new Set())
  const query = search.trim().toLowerCase()
  const visible = profiles.filter((profile) => profile.name.toLowerCase().includes(query))
  const selectedIds = visible
    .filter((profile) => selected.has(profile._id))
    .map((profile) => profile._id)
  const allSelected = visible.length > 0 && selectedIds.length === visible.length
  const busy = pendingAction !== null
  const running = pendingAction === action
  const ActionIcon = action === 'add' ? Plus : Minus

  // Changing the search clears the selection so hidden rows are never moved by accident.
  function changeSearch(value: string) {
    setSearch(value)
    setSelected(new Set<Id<'profiles'>>())
  }

  // Flips one row in or out of the selection.
  function toggle(id: Id<'profiles'>) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Selects all visible rows, or clears the selection if they are all selected.
  function toggleAll() {
    setSelected(
      allSelected ? new Set<Id<'profiles'>>() : new Set(visible.map((profile) => profile._id)),
    )
  }

  // Moves the selected rows. The selection is kept if the move fails so the user can retry.
  async function run() {
    if (selectedIds.length === 0) return
    const ok = await onMove(selectedIds, action)
    if (ok) setSelected(new Set<Id<'profiles'>>())
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line-soft bg-panel">
      <header className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
        <Checkbox
          checked={allSelected}
          onCheckedChange={toggleAll}
          disabled={busy || visible.length === 0}
          aria-label={`Select all ${title.toLowerCase()} profiles`}
        />
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        <span className="rounded-md bg-panel-muted px-1.5 text-xs text-subtle-copy tabular-nums">
          {profiles.length}
        </span>
        {notice && <span className="ml-auto text-xs text-status-warning">{notice}</span>}
      </header>

      <div className="border-b border-line-soft p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-copy" />
          <Input
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder={`Search ${title.toLowerCase()}`}
            aria-label={`Search ${title.toLowerCase()} profiles`}
            className="h-8 brand-focus border-line bg-field pl-9 text-sm"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="flex flex-1 items-center justify-center p-6 text-center text-sm text-subtle-copy">
          {profiles.length === 0 ? emptyText : 'No profiles match your search.'}
        </p>
      ) : (
        <ul className="max-h-72 min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto md:max-h-none">
          {visible.map((profile) => {
            const checked = selected.has(profile._id)
            return (
              <li key={profile._id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-panel-hover/60',
                    checked && 'bg-panel-muted/60',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(profile._id)}
                    disabled={busy}
                  />
                  <UserRound className="h-4 w-4 shrink-0 text-muted-copy" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {profile.name}
                  </span>
                  <LoginStatus loggedIn={profile.igLoggedIn} />
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3">
        <span className="text-xs text-subtle-copy tabular-nums">{selectedIds.length} selected</span>
        <Button
          size="lg"
          variant={action === 'add' ? 'default' : 'outline'}
          disabled={selectedIds.length === 0 || busy}
          onClick={() => void run()}
          className={cn('font-medium', action === 'add' ? 'brand-button' : 'button-panel')}
        >
          {running ? <Loader2 className="animate-spin" /> : <ActionIcon />}
          {action === 'add' ? 'Add' : 'Remove'}
          {selectedIds.length > 0 && ` ${selectedIds.length}`}
        </Button>
      </footer>
    </section>
  )
}

// Shows whether the profile's Instagram session is logged in.
function LoginStatus({ loggedIn }: { loggedIn?: boolean }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 text-xs',
        loggedIn ? 'text-status-success' : 'text-subtle-copy',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          loggedIn ? 'status-dot-success-tight' : 'bg-subtle-copy',
        )}
      />
      {loggedIn ? 'Logged in' : 'Not logged in'}
    </span>
  )
}

// Sorts profiles alphabetically by name for stable row order.
function byName(a: ProfileOption, b: ProfileOption) {
  return a.name.localeCompare(b.name)
}
