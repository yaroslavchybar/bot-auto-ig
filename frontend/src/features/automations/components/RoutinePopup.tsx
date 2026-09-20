import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../../convex/_generated/dataModel'
import {
  defaultRoutine,
  validateRoutine,
  type RoutinePolicy,
} from '../../../../../convex/routinePolicy'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GroupedInputs } from '../activity-ui/GroupedInputs'
import { browseFeed } from '../activities/browsing/browse-feed'

const tabs = ['General', 'Warm-up & activity', 'Outreach', 'Profiles'] as const
const fieldClass = 'bg-field border-line w-full rounded-md border p-2 text-sm'

export function RoutinePopup({
  automation,
  onClose,
}: {
  automation?: Doc<'automations'>
  onClose: () => void
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]>('General')
  const [name, setName] = useState(automation?.name ?? '')
  const [listIds, setListIds] = useState<Id<'lists'>[]>(
    automation?.listIds ?? [],
  )
  const [policy, setPolicy] = useState<RoutinePolicy>(
    automation?.routine ?? defaultRoutine,
  )
  const [saving, setSaving] = useState(false)
  const lists = useQuery(api.lists.list, {})
  const leadLists = useQuery(api.leads.lists, {})
  const create = useMutation(api.automations.mutations.create)
  const update = useMutation(api.automations.mutations.update)
  const setActive = useMutation(api.automations.mutations.setActive)
  const locked =
    automation?.isActive === true ||
    automation?.status === 'running' ||
    automation?.status === 'pending'
  const change = <K extends keyof RoutinePolicy>(
    key: K,
    value: RoutinePolicy[K],
  ) => setPolicy((p) => ({ ...p, [key]: value }))
  const numberField = (
    key: 'outreachStartDay' | 'initialDms' | 'dailyIncrease' | 'maxDms',
    label: string,
    min: number,
    max: number,
  ) => (
    <label className="grid gap-1 text-sm">
      {label}
      <Input
        type="number"
        value={policy[key]}
        min={min}
        max={max}
        onChange={(e) => change(key, Number(e.target.value))}
      />
    </label>
  )
  async function save() {
    setSaving(true)
    try {
      validateRoutine(policy)
      if (!name.trim() || !listIds.length)
        throw new Error('Enter a name and select profile lists')
      const data = {
        name: name.trim(),
        listIds,
        routine: policy,
        nodes: [],
        edges: [],
      }
      if (automation) await update({ id: automation._id, ...data })
      else await create(data)
      toast.success('Automation saved')
      onClose()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent className="bg-panel text-ink flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {automation ? automation.name : 'New automation'}
          </DialogTitle>
          <DialogDescription>
            One daily IG routine for every profile in the selected lists.
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Automation settings"
        >
          {tabs.map((t) => (
            <Button
              key={t}
              role="tab"
              aria-selected={t === tab}
              variant={t === tab ? 'default' : 'outline'}
              onClick={() => setTab(t)}
            >
              {t}
            </Button>
          ))}
        </div>
        {automation && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              {automation.isActive
                ? 'Enabled — runs daily while the server is online'
                : 'Disabled'}{' '}
              · {automation.status ?? 'idle'}
            </span>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await setActive({
                    id: automation._id,
                    isActive: !automation.isActive,
                  })
                } catch (e) {
                  toast.error(String(e))
                }
              }}
            >
              {automation.isActive ? 'Disable' : 'Enable'}
            </Button>
          </div>
        )}
        {locked && tab !== 'Profiles' && (
          <p className="text-subtle-copy text-sm">
            Disable and wait for the current session to stop before editing
            settings. Profiles and list membership can still be managed.
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-auto py-2">
          {tab === 'Profiles' ? (
            automation ? (
              <RoutineProfiles automationId={automation._id} />
            ) : (
              <p>Save the automation to manage profile setup and progress.</p>
            )
          ) : (
            <fieldset
              disabled={locked || saving}
              className="space-y-5 disabled:opacity-60"
            >
              {tab === 'General' && (
                <>
                  <label className="grid gap-1 text-sm">
                    Name
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Sender profile lists</p>
                    {lists === undefined ? (
                      <p>Loading lists…</p>
                    ) : lists.length === 0 ? (
                      <p>Create a profile list in Lists Manager first.</p>
                    ) : (
                      lists.map((list) => (
                        <label key={list._id} className="flex gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={listIds.includes(list._id)}
                            onChange={(e) =>
                              setListIds((ids) =>
                                e.target.checked
                                  ? [...ids, list._id]
                                  : ids.filter((id) => id !== list._id),
                              )
                            }
                          />
                          {list.name}
                        </label>
                      ))
                    )}
                  </div>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={policy.headless}
                      onChange={(e) => change('headless', e.target.checked)}
                    />
                    Run without a visible browser
                  </label>
                </>
              )}
              {tab === 'Warm-up & activity' && (
                <>
                  <p className="text-subtle-copy text-sm">
                    Mark profiles Logged in to start warm-up. Mark Ready for
                    outreach when their IG account is set up. Activity continues
                    during outreach. Sessions run around the clock with breaks
                    for each profile.
                  </p>
                  <GroupedInputs
                    inputs={browseFeed.inputs}
                    config={policy.activity}
                    onChange={(key, value) => {
                      if (
                        typeof value === 'number' ||
                        typeof value === 'boolean'
                      )
                        change('activity', { ...policy.activity, [key]: value })
                    }}
                  />
                </>
              )}
              {tab === 'Outreach' && (
                <>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={policy.outreachEnabled}
                      onChange={(e) =>
                        change('outreachEnabled', e.target.checked)
                      }
                    />
                    Enable outreach
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {numberField(
                      'outreachStartDay',
                      'Earliest activity day',
                      1,
                      365,
                    )}
                    {numberField(
                      'initialDms',
                      'Initial daily allowance',
                      1,
                      35,
                    )}
                    {numberField(
                      'dailyIncrease',
                      'Increase per completed outreach day',
                      0,
                      35,
                    )}
                    {numberField('maxDms', 'Maximum DMs per day', 1, 35)}
                  </div>
                  <label className="grid gap-1 text-sm">
                    Recipient lead list
                    <select
                      className={fieldClass}
                      value={policy.leadListId ?? ''}
                      onChange={(e) =>
                        change(
                          'leadListId',
                          e.target.value
                            ? (e.target.value as Id<'leadLists'>)
                            : undefined,
                        )
                      }
                    >
                      <option value="">Select lead list</option>
                      {leadLists?.map((l) => (
                        <option key={l._id} value={l._id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Message
                    <textarea
                      className={fieldClass}
                      rows={5}
                      maxLength={1000}
                      value={policy.message}
                      onChange={(e) => change('message', e.target.value)}
                    />
                  </label>
                  <p className="text-subtle-copy text-sm">
                    Use {'{{username}}'} for the recipient. Only Ready leads are
                    contacted. Messages are spread between browsing sessions,
                    within the daily allowance; unused allowance expires.
                  </p>
                </>
              )}
            </fieldset>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button onClick={() => void save()} disabled={locked || saving}>
            {saving ? 'Saving…' : 'Save automation'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RoutineProfiles({
  automationId,
}: {
  automationId: Id<'automations'>
}) {
  const rows = useQuery(api.routines.accounts, { automationId })
  const setAccount = useMutation(api.routines.setAccount)
  const mutate = async (args: Parameters<typeof setAccount>[0]) => {
    try {
      await setAccount(args)
    } catch (e) {
      toast.error(String(e))
    }
  }
  if (!rows) return <p>Loading profiles…</p>
  if (!rows.length) return <p>Add profiles to the selected lists to start.</p>
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div
          key={row.profileId}
          className="border-line space-y-3 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{row.name}</strong>
            <span className="text-sm">
              {row.paused
                ? 'Paused'
                : row.issue
                  ? 'Needs attention'
                  : row.stage}{' '}
              · {row.activeDays} active days · DMs {row.used}/{row.allowance}
            </span>
          </div>
          {row.issue && (
            <p className="text-status-danger text-sm">{row.issue}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void mutate({ profileId: row.profileId, paused: !row.paused })
              }
            >
              {row.paused ? 'Resume' : 'Pause'}
            </Button>
            {row.issue && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void mutate({ profileId: row.profileId, clearIssue: true })
                }
              >
                Issue resolved
              </Button>
            )}
            <span className="text-subtle-copy text-xs">
              Next eligible session:{' '}
              {row.nextRunAt
                ? new Date(row.nextRunAt).toLocaleString()
                : 'When logged in and its rest period ends'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
