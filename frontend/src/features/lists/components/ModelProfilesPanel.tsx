import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Plus, Search, UserRound, X } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { List } from '../types'

export function ModelProfilesPanel({ model }: { model: List }) {
  const profiles = useQuery(api.profiles.queries.list, {}) as Doc<'profiles'>[] | undefined
  const add = useMutation(api.profiles.mutations.bulkAddToList)
  const remove = useMutation(api.profiles.mutations.bulkRemoveFromList)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const modelId = model.id as Id<'lists'>
  const assigned = (profiles ?? []).filter((profile) => profile.listIds?.includes(modelId))
    .sort((a, b) => a.name.localeCompare(b.name))
  const available = (profiles ?? []).filter((profile) => !profile.listIds?.length && profile.status !== 'deleting')
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
          <h3 className="text-ink font-semibold">Connected profiles</h3>
          <p className="text-subtle-copy mt-1 text-sm">Profiles assigned to {model.name}.</p>
        </div>
        <span className="bg-panel-muted text-subtle-copy rounded-full px-3 py-1 text-xs tabular-nums">
          {assigned.length} profiles
        </span>
      </div>
      {error && <p role="alert" className="text-status-danger mb-4 text-sm">{error}</p>}
      {profiles === undefined ? (
        <p className="text-subtle-copy py-8 text-center text-sm">Loading profiles...</p>
      ) : (
        <>
          {assigned.length === 0 ? (
            <div className="border-line-soft text-subtle-copy rounded-xl border-2 border-dashed p-8 text-center text-sm">
              No profiles assigned to this model yet.
            </div>
          ) : (
            <ul className="border-line-soft divide-line-soft divide-y overflow-hidden rounded-xl border">
              {assigned.map((profile) => (
                <li key={profile._id} className="flex items-center gap-3 px-4 py-3">
                  <UserRound className="text-muted-copy h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate text-sm font-medium">{profile.name}</p>
                    <p className="text-subtle-copy text-xs">
                      {profile.igLoggedIn ? 'IG logged in' : 'IG not logged in'}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" disabled={busyId !== null}
                    onClick={() => void change([profile._id], 'remove')}
                    className="text-muted-copy hover:text-status-danger shrink-0" aria-label={`Remove ${profile.name} from model`}>
                    <X className="h-4 w-4" /> Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-line-soft mt-6 border-t pt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-ink font-semibold">Add profiles</h3>
              {available.length > 0 && (
                <Button variant="ghost" size="sm" disabled={busyId !== null}
                  onClick={() => void change(available.map((profile) => profile._id), 'add')}>
                  Add all{search.trim() ? ' matches' : ''} ({available.length})
                </Button>
              )}
            </div>
            <p className="text-subtle-copy mt-1 text-sm">Choose from profiles without a model.</p>
            <div className="relative mt-3">
              <Search className="text-muted-copy pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search available profiles" aria-label="Search available profiles"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && displayed[0]) void change([displayed[0]._id], 'add')
                }}
                className="brand-focus bg-field border-line h-9 pl-9" />
            </div>
            {available.length === 0 ? (
              <p className="text-subtle-copy py-6 text-center text-sm">No available profiles found.</p>
            ) : (
              <ul className="border-line-soft divide-line-soft mt-3 divide-y overflow-hidden rounded-xl border">
                {displayed.map((profile) => (
                  <li key={profile._id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-ink min-w-0 flex-1 truncate text-sm">{profile.name}</span>
                    <Button variant="outline" size="sm" disabled={busyId !== null}
                      onClick={() => void change([profile._id], 'add')}
                      className="button-panel h-8 shrink-0" aria-label={`Add ${profile.name} to model`}>
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {available.length > 50 && (
              <p className="text-subtle-copy mt-2 text-xs">Showing 50 of {available.length}. Search to find another profile.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
