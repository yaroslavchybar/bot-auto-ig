import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { OutreachRoute } from '../../../../../convex/routinePolicy'

// Who receives a scraped list's DMs. Each option sets the route's allProfiles flag.
const audiences = [
  { allProfiles: true, label: 'All profiles' },
  { allProfiles: false, label: 'Choose profiles' },
] as const

// Maps each scraped list to the profiles and message that handle its outreach.
export function OutreachAssignments({
  routes,
  lists,
  profiles,
  disabled,
  loading,
  onChange,
}: {
  routes: OutreachRoute[]
  lists: { _id: Id<'leadLists'>; name: string }[]
  profiles: { _id: Id<'profiles'>; name: string }[]
  disabled: boolean
  loading: boolean
  onChange: (routes: OutreachRoute[]) => void
}) {
  const available = lists.filter((list) => !routes.some((route) => route.leadListId === list._id))
  const change = (index: number, patch: Partial<OutreachRoute>) =>
    onChange(routes.map((route, i) => (i === index ? { ...route, ...patch } : route)))

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Scraped lists</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="button-panel"
          disabled={disabled || loading || !available.length || routes.length >= 20}
          onClick={() => {
            const list = available[0]
            if (list) onChange([...routes, { leadListId: list._id, profileIds: [], message: '' }])
          }}
        >
          <Plus /> Add list
        </Button>
      </div>

      {routes.length === 0 && (
        <p className="rounded-xl border border-dashed border-line-soft p-6 text-center text-sm text-subtle-copy">
          Add a scraped list, then choose which profiles DM it.
        </p>
      )}

      {routes.map((route, index) => {
        const allProfiles = route.allProfiles ?? false
        const missing = route.profileIds.filter(
          (id) => !profiles.some((profile) => profile._id === id),
        ).length
        return (
          <div
            key={route.leadListId}
            className="space-y-4 rounded-xl border border-line-soft bg-panel p-4"
          >
            <div className="flex items-center gap-2">
              <Select
                value={route.leadListId}
                disabled={disabled || loading}
                onValueChange={(id) => change(index, { leadListId: id as Id<'leadLists'> })}
              >
                <SelectTrigger
                  aria-label={`Scraped list ${index + 1}`}
                  className="h-9 brand-focus border-line bg-field text-ink"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="panel-dropdown">
                  {!lists.some((list) => list._id === route.leadListId) && (
                    <SelectItem value={route.leadListId}>Unavailable list</SelectItem>
                  )}
                  {lists
                    .filter(
                      (list) =>
                        list._id === route.leadListId ||
                        available.some((item) => item._id === list._id),
                    )
                    .map((list) => (
                      <SelectItem key={list._id} value={list._id}>
                        {list.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remove scraped list ${index + 1}`}
                onClick={() => onChange(routes.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="inline-flex rounded-lg border border-line bg-field p-0.5">
                {audiences.map((audience) => {
                  const selected = allProfiles === audience.allProfiles
                  return (
                    <button
                      key={audience.label}
                      type="button"
                      aria-pressed={selected}
                      disabled={disabled}
                      onClick={() =>
                        change(index, { allProfiles: audience.allProfiles, profileIds: [] })
                      }
                      className={cn(
                        'h-7 rounded-md px-3 text-xs font-medium transition-colors disabled:opacity-50',
                        selected
                          ? 'bg-panel-selected text-ink shadow-sm'
                          : 'text-muted-copy hover:text-ink',
                      )}
                    >
                      {audience.label}
                    </button>
                  )
                })}
              </div>
              {allProfiles && (
                <span className="text-xs text-subtle-copy">Includes profiles added later</span>
              )}
            </div>

            {!allProfiles && (
              <div className="space-y-2">
                {loading ? (
                  <p className="text-xs text-subtle-copy">Loading profiles…</p>
                ) : profiles.length === 0 ? (
                  <p className="text-xs text-subtle-copy">No profiles in this model.</p>
                ) : (
                  <div
                    role="group"
                    aria-label={`Profiles for scraped list ${index + 1}`}
                    className="flex flex-wrap gap-1.5"
                  >
                    {profiles.map((profile) => {
                      const selected = route.profileIds.includes(profile._id)
                      return (
                        <button
                          key={profile._id}
                          type="button"
                          aria-pressed={selected}
                          disabled={disabled}
                          onClick={() =>
                            change(index, {
                              profileIds: selected
                                ? route.profileIds.filter((id) => id !== profile._id)
                                : [...route.profileIds, profile._id],
                            })
                          }
                          className={cn(
                            'h-7 rounded-full border px-3 text-xs transition-colors disabled:opacity-50',
                            selected
                              ? 'border-line-strong bg-panel-selected text-ink'
                              : 'border-line text-muted-copy hover:border-line-strong hover:text-ink',
                          )}
                        >
                          {profile.name}
                        </button>
                      )
                    })}
                  </div>
                )}
                {missing > 0 && !loading && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-status-danger-soft px-3 py-2 text-xs text-status-danger">
                    <span>{missing} no longer in this model</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        change(index, {
                          profileIds: route.profileIds.filter((id) =>
                            profiles.some((profile) => profile._id === id),
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label
                  htmlFor={`assignment-message-${index}`}
                  className="text-[13px] font-medium text-copy"
                >
                  Message
                </Label>
                <span className="text-xs text-subtle-copy tabular-nums">
                  {route.message.length}/1000
                </span>
              </div>
              <Textarea
                id={`assignment-message-${index}`}
                disabled={disabled}
                rows={3}
                maxLength={1000}
                value={route.message}
                onChange={(event) => change(index, { message: event.target.value })}
                placeholder="Hi {{username}}…"
                className="brand-focus border-line bg-field text-ink"
              />
            </div>
          </div>
        )
      })}
    </section>
  )
}
