import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { OutreachRoute } from '../../../../../convex/routinePolicy'

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Scraped-list assignments</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || loading || !available.length || routes.length >= 20}
          onClick={() => {
            const list = available[0]
            if (list) onChange([...routes, { leadListId: list._id, profileIds: [], message: '' }])
          }}
        >
          <Plus /> Add assignment
        </Button>
      </div>
      <p className="text-xs text-subtle-copy">
        A profile can serve several lists. It alternates between them using one shared daily DM
        limit.
      </p>
      {!routes.length && (
        <p className="text-sm text-subtle-copy">
          Add a scraped list, choose profiles, and write its message.
        </p>
      )}
      {routes.map((route, index) => (
        <fieldset
          key={route.leadListId}
          disabled={disabled}
          className="space-y-3 rounded-xl border border-line-soft bg-panel-subtle/40 p-3"
        >
          <legend className="px-1 text-xs font-medium">Assignment {index + 1}</legend>
          <div className="flex items-center gap-2">
            <Select
              value={route.leadListId}
              disabled={disabled || loading}
              onValueChange={(id) => change(index, { leadListId: id as Id<'leadLists'> })}
            >
              <SelectTrigger
                aria-label={`Scraped list for assignment ${index + 1}`}
                className="border-line bg-field"
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
              aria-label={`Remove assignment ${index + 1}`}
              onClick={() => onChange(routes.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              disabled={disabled}
              checked={route.allProfiles ?? false}
              onCheckedChange={(checked) =>
                change(index, { allProfiles: checked === true, profileIds: [] })
              }
            />
            All profiles in this model, including future profiles
          </label>
          {!route.allProfiles && (
            <div
              role="group"
              aria-label={`Profiles for assignment ${index + 1}`}
              className="grid max-h-40 gap-2 overflow-auto sm:grid-cols-2"
            >
              {loading ? (
                <p className="text-xs text-subtle-copy">Loading profiles…</p>
              ) : !profiles.length ? (
                <p className="text-xs text-subtle-copy">Choose a model with profiles in General.</p>
              ) : (
                profiles.map((profile) => (
                  <label key={profile._id} className="flex min-w-0 items-center gap-2 text-sm">
                    <Checkbox
                      disabled={disabled}
                      checked={route.profileIds.includes(profile._id)}
                      onCheckedChange={(checked) =>
                        change(index, {
                          profileIds:
                            checked === true
                              ? [...route.profileIds, profile._id]
                              : route.profileIds.filter((id) => id !== profile._id),
                        })
                      }
                    />
                    <span className="truncate">{profile.name}</span>
                  </label>
                ))
              )}
              {route.profileIds.some((id) => !profiles.some((profile) => profile._id === id)) &&
                !loading && (
                  <div className="text-xs text-status-danger">
                    Some assigned profiles left this model.{' '}
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
                      Remove unavailable profiles
                    </Button>
                  </div>
                )}
            </div>
          )}
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor={`assignment-message-${index}`}>Message</Label>
              <span className="text-xs text-subtle-copy">{route.message.length}/1000</span>
            </div>
            <Textarea
              id={`assignment-message-${index}`}
              disabled={disabled}
              rows={3}
              maxLength={1000}
              value={route.message}
              onChange={(event) => change(index, { message: event.target.value })}
              placeholder="Hi {{username}} ..."
              className="border-line bg-field"
            />
          </div>
        </fieldset>
      ))}
    </div>
  )
}
