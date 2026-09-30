import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Plus, Search, UserRound, X } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { List } from '../types'

export function ModelProfilesPanel({ model, active = true }: { model: List; active?: boolean }) {
  const profiles = useQuery(api.profiles.queries.modelOptions, active ? {} : 'skip')
  const add = useMutation(api.profiles.mutations.bulkAddToList)
  const remove = useMutation(api.profiles.mutations.bulkRemoveFromList)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const modelId = model.id as Id<'lists'>
  const assigned = (profiles ?? [])
    .filter((profile) => profile.listIds?.includes(modelId))
    .sort((a, b) => a.name.localeCompare(b.name))
  const available = (profiles ?? [])
    .filter((profile) => !profile.listIds?.length && profile.status !== 'deleting')
    .filter((profile) => profile.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  const displayed = available.slice(0, 50)

  async function change(profileIds: Id<'profiles'>[], action: 'add' | 'remove') {
    if (busyId) return
    setBusyId(profileIds.length === 1 ? profileIds[0] : 'all')
    setError('')
    try {
      const args = { profileIds, listId: modelId }
      if (action === 'add') await add(args)
      else await remove(args)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink">Connected profiles</h3>
          <p className="mt-1 text-sm text-subtle-copy">Profiles assigned to {model.name}.</p>
        </div>
        <span className="rounded-full bg-panel-muted px-3 py-1 text-xs text-subtle-copy tabular-nums">
          {assigned.length} profiles
        </span>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-status-danger">
          {error}
        </p>
      )}
      {profiles === undefined ? (
        <p className="py-8 text-center text-sm text-subtle-copy">Loading profiles...</p>
      ) : (
        <>
          {assigned.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-line-soft p-8 text-center text-sm text-subtle-copy">
              No profiles assigned to this model yet.
            </div>
          ) : (
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line-soft">
              {assigned.map((profile) => (
                <li key={profile._id} className="flex items-center gap-3 px-4 py-3">
                  <UserRound className="h-4 w-4 shrink-0 text-muted-copy" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{profile.name}</p>
                    <p className="text-xs text-subtle-copy">
                      {profile.igLoggedIn ? 'IG logged in' : 'IG not logged in'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void change([profile._id], 'remove')}
                    className="shrink-0 text-muted-copy hover:text-status-danger"
                    aria-label={`Remove ${profile.name} from model`}
                  >
                    <X className="h-4 w-4" /> Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 border-t border-line-soft pt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-ink">Add profiles</h3>
              {available.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() =>
                    void change(
                      available.map((profile) => profile._id),
                      'add',
                    )
                  }
                >
                  Add all{search.trim() ? ' matches' : ''} ({available.length})
                </Button>
              )}
            </div>
            <p className="mt-1 text-sm text-subtle-copy">Choose from profiles without a model.</p>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search available profiles"
                aria-label="Search available profiles"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && displayed[0]) void change([displayed[0]._id], 'add')
                }}
                className="h-9 brand-focus border-line bg-field pl-9"
              />
            </div>
            {available.length === 0 ? (
              <p className="py-6 text-center text-sm text-subtle-copy">
                No available profiles found.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-xl border border-line-soft">
                {displayed.map((profile) => (
                  <li key={profile._id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{profile.name}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId !== null}
                      onClick={() => void change([profile._id], 'add')}
                      className="h-8 shrink-0 button-panel"
                      aria-label={`Add ${profile.name} to model`}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {available.length > 50 && (
              <p className="mt-2 text-xs text-subtle-copy">
                Showing 50 of {available.length}. Search to find another profile.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
