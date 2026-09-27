import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { CircleAlert } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import { apiFetch } from '@/lib/api'
import type { Doc, Id } from '../../../../../convex/_generated/dataModel'
import {
  defaultRoutine,
  validateRoutine,
  type RoutinePolicy,
} from '../../../../../convex/routinePolicy'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GroupedInputs } from '../activity-ui/GroupedInputs'
import { browseFeed } from '../activities/browsing/browse-feed'
import { cn } from '@/lib/utils'

const tabs = ['General', 'Warm-up & activity', 'Outreach', 'Profiles'] as const

type ModelWarmup = {
  profileId: string
  modelId: string
  startedAt: number
  nameDone?: boolean
  avatarDone?: boolean
  postSourceIds: string[]
  pending?: { kind: string }
  error?: string
}

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
  const automations = useQuery(api.automations.queries.list, {})
  const leadLists = useQuery(api.leads.lists, {})
  const create = useMutation(api.automations.mutations.create)
  const update = useMutation(api.automations.mutations.update)
  const locked =
    automation?.isActive === true ||
    automation?.status === 'running' ||
    automation?.status === 'pending'
  const change = <K extends keyof RoutinePolicy>(
    key: K,
    value: RoutinePolicy[K],
  ) => setPolicy((p) => ({ ...p, [key]: value }))
  const numberField = (
    key: 'outreachStartDay' | 'initialDms' | 'maxDms',
    label: string,
    min: number,
    max: number,
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`routine-${key}`}>{label}</Label>
      <Input
        id={`routine-${key}`}
        type="number"
        value={Number.isNaN(policy[key]) ? '' : policy[key]}
        min={min}
        max={max}
        onChange={(e) =>
          change(key, e.target.value === '' ? Number.NaN : Number(e.target.value))
        }
        className="bg-field border-line"
      />
    </div>
  )
  async function save() {
    setSaving(true)
    try {
      validateRoutine(policy)
      if (!name.trim() || listIds.length !== 1)
        throw new Error('Enter a name and select one model')
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
      <DialogContent
        aria-describedby={undefined}
        className="bg-panel border-line text-ink flex h-[90vh] flex-col sm:max-w-4xl"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="page-title-gradient">
            {automation ? automation.name : 'New automation'}
          </DialogTitle>
        </DialogHeader>

        <div
          className="flex shrink-0 flex-wrap gap-2"
          role="tablist"
          aria-label="Automation settings"
        >
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              onClick={() => setTab(t)}
              className={cn(
                'inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                t === tab
                  ? 'border-line-strong bg-panel-selected text-ink'
                  : 'border-line text-muted-copy hover:border-line-strong hover:text-ink',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {locked && tab !== 'Profiles' && (
          <div className="bg-status-info-soft border-status-info-border text-status-info flex shrink-0 items-start gap-2 rounded-xl border px-4 py-2.5 text-xs">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Disable and wait for the current session to stop before editing
            settings. Profiles and model membership can still be managed.
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto py-2">
          {tab === 'Profiles' ? (
            automation ? (
              <RoutineProfiles automationId={automation._id} modelId={automation.listIds?.[0]} />
            ) : (
              <p className="text-subtle-copy text-sm">
                Save the automation to manage profile setup and progress.
              </p>
            )
          ) : (
            <fieldset
              disabled={locked || saving}
              className="space-y-5 disabled:opacity-60"
            >
              {tab === 'General' && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="routine-name">Name</Label>
                    <Input
                      id="routine-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="My automation"
                      className="bg-field border-line"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Model</Label>
                    {lists === undefined ? (
                      <p className="text-subtle-copy text-sm">Loading models…</p>
                    ) : lists.length === 0 ? (
                      <p className="text-subtle-copy text-sm">
                        Create a model first.
                      </p>
                    ) : (
                      <Select value={listIds[0] ?? ''} onValueChange={(id) => setListIds([id as Id<'lists'>])}>
                        <SelectTrigger className="bg-field border-line"><SelectValue placeholder="Choose a model" /></SelectTrigger>
                        <SelectContent className="panel-dropdown">
                          {lists.map((list) => {
                            const assigned = automations?.some((row) =>
                              row._id !== automation?._id && row.routine && row.listIds?.includes(list._id))
                            return (
                              <SelectItem key={list._id} value={list._id} disabled={assigned}>
                                {list.name}{assigned ? ' · already has an automation' : ''}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <label className="bg-panel-subtle/40 border-line-soft flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3">
                    <span>
                      <span className="text-copy block text-sm font-medium">
                        Run without a visible browser
                      </span>
                      <span className="text-subtle-copy mt-0.5 block text-xs">
                        Headless sessions use fewer resources
                      </span>
                    </span>
                    <Switch
                      checked={policy.headless}
                      onCheckedChange={(checked) =>
                        change('headless', checked)
                      }
                      className="brand-switch shrink-0"
                    />
                  </label>
                </>
              )}
              {tab === 'Warm-up & activity' && (
                <>
                  <p className="text-subtle-copy text-sm">
                    Browser login starts model setup. Daily feed browsing starts
                    the next day with its time budget. On day 3, the mobile session
                    connects through the Work proxy and the name changes. Day 4
                    adds the avatar and starts nine daily posts. After
                    the ninth post, the profile becomes ready for outreach.
                    Activity continues during outreach with breaks between sessions.
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
                  <label className="bg-panel-subtle/40 border-line-soft flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3">
                    <span>
                      <span className="text-copy block text-sm font-medium">
                        Enable outreach
                      </span>
                      <span className="text-subtle-copy mt-0.5 block text-xs">
                        Work toward the daily DM target within the daily time budget
                      </span>
                    </span>
                    <Switch
                      checked={policy.outreachEnabled}
                      onCheckedChange={(checked) =>
                        change('outreachEnabled', checked)
                      }
                      className="brand-switch shrink-0"
                    />
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
                      'Initial daily target',
                      1,
                      35,
                    )}
                    {numberField('maxDms', 'Maximum DMs per day', 1, 35)}
                  </div>
                  <p className="text-subtle-copy text-xs">
                    The daily target increases by a random 1–4 after each day with a confirmed DM,
                    up to the maximum. Sessions alternate browsing and batches of 1–5 DMs.
                    Browsing, sending, and 30–90 second DM pauses share the daily time budget.
                    Delivery problems or insufficient time can leave the target incomplete.
                  </p>
                  <div className="grid gap-1.5">
                    <Label htmlFor="routine-lead-list">Recipient lead list</Label>
                    <Select
                      value={policy.leadListId ?? 'none'}
                      onValueChange={(v) =>
                        change(
                          'leadListId',
                          v === 'none' ? undefined : (v as Id<'leadLists'>),
                        )
                      }
                    >
                      <SelectTrigger
                        id="routine-lead-list"
                        className="bg-field border-line"
                      >
                        <SelectValue placeholder="Select lead list" />
                      </SelectTrigger>
                      <SelectContent className="panel-dropdown">
                        <SelectItem value="none">No lead list</SelectItem>
                        {leadLists?.map((l) => (
                          <SelectItem key={l._id} value={l._id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <div className="flex items-baseline justify-between">
                      <Label htmlFor="routine-message">Message</Label>
                      <span className="text-subtle-copy font-mono text-[11px]">
                        {policy.message.length}/1000
                      </span>
                    </div>
                    <Textarea
                      id="routine-message"
                      rows={5}
                      maxLength={1000}
                      value={policy.message}
                      onChange={(e) => change('message', e.target.value)}
                      placeholder="Hi {{username}} ..."
                      className="bg-field border-line"
                    />
                  </div>
                  <p className="text-subtle-copy text-sm">
                    Use {'{{username}}'} for the recipient. Claimed, messaged, or
                    followed leads are skipped for new sessions. A lead followed
                    in the current session still receives its DM.
                  </p>
                </>
              )}
            </fieldset>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-line pt-3">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            className="button-ghost"
          >
            Close
          </Button>
          <Button
            onClick={() => void save()}
            disabled={locked || saving}
            className="brand-button"
          >
            {saving ? 'Saving…' : 'Save automation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoutineProfiles({
  automationId,
  modelId,
}: {
  automationId: Id<'automations'>
  modelId?: Id<'lists'>
}) {
  const rows = useQuery(api.routines.accounts, { automationId })
  const setAccount = useMutation(api.routines.setAccount)
  const [warmups, setWarmups] = useState<ModelWarmup[]>([])
  const [warmupError, setWarmupError] = useState('')
  const [reviewing, setReviewing] = useState<string | null>(null)

  useEffect(() => {
    if (!modelId) return
    let active = true
    const refresh = () => {
      void apiFetch<ModelWarmup[]>('/api/ig-accounts/warmup')
        .then((result) => {
          if (active) { setWarmups(result.filter((item) => item.modelId === modelId)); setWarmupError('') }
        })
        .catch((error) => { if (active) setWarmupError(error instanceof Error ? error.message : String(error)) })
    }
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [modelId])
  const mutate = async (args: Parameters<typeof setAccount>[0]) => {
    try {
      await setAccount(args)
    } catch (e) {
      toast.error(String(e))
    }
  }
  const reconcile = async (profileId: string, resolution: 'completed' | 'failed') => {
    if (resolution === 'failed' && !window.confirm('Confirm this action did not succeed in Instagram. Retrying a successful post would publish it twice.')) return
    setReviewing(profileId)
    try {
      await apiFetch(`/api/ig-accounts/warmup/${profileId}/reconcile`, {
        method: 'POST', body: { resolution },
      })
      const result = await apiFetch<ModelWarmup[]>('/api/ig-accounts/warmup')
      setWarmups(result.filter((item) => item.modelId === modelId))
      toast.success(resolution === 'completed' ? 'Action marked complete' : 'Action ready to retry')
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setReviewing(null) }
  }
  if (!rows)
    return <p className="text-subtle-copy text-sm">Loading profiles…</p>
  if (!rows.length)
    return (
      <p className="text-subtle-copy text-sm">
        Add profiles to this model to start.
      </p>
    )
  return (
    <div className="space-y-2">
      {warmupError && <p role="alert" className="text-status-danger text-xs">Warm-up progress: {warmupError}</p>}
      {rows.map((row) => (
        <div
          key={row.profileId}
          className="bg-panel-subtle/40 border-line-soft flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3"
        >
          <span className="text-ink text-sm font-semibold">{row.name}</span>
          <Badge
            variant="outline"
            className={cn(
              'border text-[10px] tracking-[0.18em] uppercase',
              row.paused
                ? 'border-line bg-panel-muted text-copy'
                : row.issue
                  ? 'border-status-danger-border bg-status-danger-soft text-status-danger'
                  : 'border-status-success-border bg-status-success-soft text-status-success',
            )}
          >
            {row.paused
              ? 'Paused'
              : row.issue
                ? 'Needs attention'
                : row.stage}
          </Badge>
          <span className="text-muted-copy text-xs">
            {row.activeDays} active days · DMs {row.sent}/{row.allowance}
            {row.budgetExhausted && row.sent < row.allowance ? ' · Target incomplete: time budget used' : ''}
          </span>
          <ModelSetupStatus progress={warmups.find((item) => item.profileId === row.profileId)}
            reviewing={reviewing === row.profileId}
            onReview={(resolution) => void reconcile(String(row.profileId), resolution)} />
          <Button
            size="sm"
            variant="outline"
            className="h-8"
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
              className="h-8"
              onClick={() =>
                void mutate({ profileId: row.profileId, clearIssue: true })
              }
            >
              Issue resolved
            </Button>
          )}
          <span className="text-subtle-copy ml-auto text-xs">
            Next session:{' '}
            {row.nextRunAt
              ? new Date(row.nextRunAt).toLocaleString()
              : 'When eligible and its rest period ends'}
          </span>
          {row.issue && (
            <p className="text-status-danger basis-full text-xs">{row.issue}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function ModelSetupStatus({ progress, reviewing, onReview }: { progress?: ModelWarmup;
  reviewing: boolean; onReview: (resolution: 'completed' | 'failed') => void }) {
  return (
    <div className="text-subtle-copy basis-full text-xs">
      Setup: {progress
        ? `Name ${progress.nameDone ? 'done' : 'waiting'} · Avatar ${progress.avatarDone ? 'done' : 'waiting'} · Posts ${progress.postSourceIds.length}/9${progress.pending ? ` · Review ${progress.pending.kind}` : ''}`
        : 'Starts after IG connects and this automation is enabled'}
      {progress?.error && <span className="text-status-danger mt-1 block">{progress.error}</span>}
      {progress?.pending && <div className="mt-2 flex flex-wrap items-center gap-2">
        <span>Check Instagram before resolving this {progress.pending.kind} action.</span>
        <Button size="sm" variant="outline" disabled={reviewing} onClick={() => onReview('completed')}>It succeeded</Button>
        <Button size="sm" variant="outline" disabled={reviewing} onClick={() => onReview('failed')}>It failed, retry</Button>
      </div>}
    </div>
  )
}
