import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { Flame, Send, Settings2, Users } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../../convex/_generated/dataModel'
import {
  defaultRoutine,
  outreachRoutes,
  validateRoutine,
  warmupPostRange,
  type RoutinePolicy,
} from '../../../../../convex/routinePolicy'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { browseFeed } from '../activities/browsing/browse-feed'
import type { ActivityInput } from '../activities/types'
import { getAutomationDisplayStatus, getStatusColor, getStatusLabel } from '../types'
import { OutreachAssignments } from './OutreachAssignments'
import { RoutineProfiles } from './RoutineProfiles'
import {
  Field,
  NumberField,
  PercentField,
  RangeField,
  SettingsGroup,
  ToggleRow,
  type Limits,
} from './RoutineFields'
import { cn } from '@/lib/utils'

// Tabs in display order. Profiles shows live status, so it has no save footer.
const tabs = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'warmup', label: 'Warm-up', icon: Flame },
  { id: 'outreach', label: 'Outreach', icon: Send },
  { id: 'profiles', label: 'Profiles', icon: Users },
] as const

type TabId = (typeof tabs)[number]['id']

// Returns a warm-up setting's definition from browse-feed.ts, which holds its bounds and defaults.
function feedSetting(name: string): ActivityInput {
  const input = browseFeed.inputs.find((item) => item.name === name)
  if (!input) throw new Error(`Unknown warm-up setting: ${name}`)
  return input
}

// Creates or edits an automation. Settings save together; the Profiles tab updates live on its own.
export function RoutinePopup({
  automation,
  onClose,
}: {
  automation?: Doc<'automations'>
  onClose: () => void
}) {
  const [tab, setTab] = useState<TabId>('general')
  const [name, setName] = useState(automation?.name ?? '')
  const [listIds, setListIds] = useState<Id<'lists'>[]>(automation?.listIds ?? [])
  const [policy, setPolicy] = useState<RoutinePolicy>(() => {
    const initial = automation?.routine ?? defaultRoutine
    return {
      ...initial,
      leadListId: undefined,
      message: '',
      outreachRoutes: outreachRoutes(initial),
    }
  })
  const [saving, setSaving] = useState(false)
  const lists = useQuery(api.lists.list, {})
  const automations = useQuery(api.automations.queries.list, {})
  const leadLists = useQuery(api.leads.lists, {})
  const profiles = useQuery(api.profiles.queries.modelOptions, {})
  const create = useMutation(api.automations.mutations.create)
  const update = useMutation(api.automations.mutations.update)

  const locked =
    automation?.isActive === true ||
    automation?.status === 'running' ||
    automation?.status === 'pending'
  const formDisabled = locked || saving
  // Compares the current values with the starting values to detect unsaved changes.
  const snapshot = JSON.stringify({ name, listIds, policy })
  const [savedSnapshot] = useState(snapshot)
  const dirty = snapshot !== savedSnapshot
  // The first reason the automation cannot be saved yet. The footer shows it next to the disabled button.
  const blocker = !name.trim()
    ? 'Add a name'
    : listIds.length !== 1
      ? 'Choose a model'
      : routineProblem(policy)
  const canSave = !blocker && dirty && !locked && !saving
  const displayStatus = automation ? getAutomationDisplayStatus(automation) : undefined
  const footerNote = locked
    ? automation?.isActive
      ? 'Turn off to edit'
      : 'Wait for the run to stop'
    : blocker || (dirty ? 'Unsaved changes' : '')

  const change = <K extends keyof RoutinePolicy>(key: K, value: RoutinePolicy[K]) =>
    setPolicy((p) => ({ ...p, [key]: value }))
  // Reads an activity setting, falling back to its default when it has never been saved.
  const num = (key: string) => Number(policy.activity[key] ?? feedSetting(key).default)
  const flag = (key: string) => Boolean(policy.activity[key] ?? feedSetting(key).default)
  const setActivity = (patch: Record<string, number | boolean>) =>
    change('activity', { ...policy.activity, ...patch })

  // Plain-English summaries shown at the top of the Warm-up and Outreach tabs.
  const [postsMin, postsMax] = warmupPostRange(policy)
  const warmupSummary = `Browse ${span(num('warmup_min_minutes'), num('warmup_max_minutes'))} min a day in ${span(num('session_min_minutes'), num('session_max_minutes'))} min sessions, resting ${span(num('rest_min_minutes'), num('rest_max_minutes'))} min between them. Each profile needs ${span(postsMin, postsMax)} posts before outreach.`
  const outreachSummary = policy.outreachEnabled
    ? `Sends from day ${policy.outreachStartDay}: ${policy.initialDms} DMs a day, up to ${policy.maxDms}.`
    : 'Off. No DMs are sent.'

  // Binds a 0–100 activity setting to a slider.
  const percentSetting = (label: string, key: string) => (
    <PercentField
      id={key}
      label={label}
      value={num(key)}
      onChange={(value) => setActivity({ [key]: value })}
    />
  )
  // Binds one numeric activity setting. Bounds come from browse-feed.ts.
  const numberSetting = (label: string, key: string, unit?: string) => (
    <NumberField
      id={key}
      label={label}
      unit={unit}
      limits={limitsOf(feedSetting(key))}
      value={num(key)}
      onChange={(value) => setActivity({ [key]: value })}
    />
  )
  // Binds a min/max activity pair. Bounds come from the two settings' definitions.
  const rangeSetting = (label: string, minKey: string, maxKey: string, unit?: string) => (
    <RangeField
      id={minKey}
      label={label}
      unit={unit}
      limits={{
        min: feedSetting(minKey).min,
        max: feedSetting(maxKey).max,
        step: feedSetting(minKey).step,
      }}
      minValue={num(minKey)}
      maxValue={num(maxKey)}
      onChange={(min, max) => setActivity({ [minKey]: min, [maxKey]: max })}
    />
  )
  // Binds a min/max pair stored on the routine itself, such as warm-up posts.
  const routineRange = (
    id: string,
    label: string,
    unit: string,
    minKey: 'warmupMinPosts' | 'unfollowMinDays',
    maxKey: 'warmupMaxPosts' | 'unfollowMaxDays',
    limit: number,
    fallback: number,
  ) => (
    <RangeField
      id={id}
      label={label}
      unit={unit}
      limits={{ min: 1, max: limit }}
      minValue={policy[minKey] ?? fallback}
      maxValue={policy[maxKey] ?? fallback}
      onChange={(min, max) => {
        change(minKey, min)
        change(maxKey, max)
      }}
    />
  )
  // Binds an integer stored on the routine itself, such as the daily DM cap.
  const routineNumber = (
    id: string,
    label: string,
    key: 'outreachStartDay' | 'initialDms' | 'maxDms',
    limits: { min: number; max: number },
  ) => (
    <NumberField
      id={id}
      label={label}
      limits={limits}
      value={policy[key]}
      onChange={(value) => change(key, value)}
    />
  )

  // Validates the routine, then creates or updates the automation and closes the dialog.
  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      validateRoutine(policy)
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
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  // Cmd/Ctrl+S saves settings; Profiles updates live without saving.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (tab !== 'profiles') void save()
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
        onKeyDown={handleKeyDown}
        className="flex h-[min(90dvh,44rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="shrink-0 flex-row items-center gap-3 space-y-0 border-b border-line-soft px-6 py-4 pr-12">
          <DialogTitle className="min-w-0 truncate page-title-gradient">
            {automation?.name ?? 'New automation'}
          </DialogTitle>
          {automation && displayStatus && (
            <Badge variant={getStatusColor(displayStatus)} className="shrink-0">
              {getStatusLabel(displayStatus)}
            </Badge>
          )}
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label="Automation settings"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-line-soft p-2 md:w-44 md:flex-col md:border-r md:border-b-0 md:p-3"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={id === tab ? 'page' : undefined}
                onClick={() => setTab(id)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors',
                  id === tab
                    ? 'bg-panel-selected text-ink'
                    : 'text-muted-copy hover:bg-panel-hover hover:text-ink',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {tab === 'general' && (
              <fieldset disabled={formDisabled} className="grid gap-5 sm:grid-cols-2">
                <Field id="routine-name" label="Name">
                  <Input
                    id="routine-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="My automation"
                    className="h-9 brand-focus border-line bg-field text-ink"
                  />
                </Field>
                <Field id="routine-model" label="Model">
                  {lists === undefined ? (
                    <p className="text-sm text-subtle-copy">Loading…</p>
                  ) : lists.length === 0 ? (
                    <p className="text-sm text-subtle-copy">No models yet.</p>
                  ) : (
                    <Select
                      value={listIds[0] ?? ''}
                      onValueChange={(id) => {
                        setListIds([id as Id<'lists'>])
                        change(
                          'outreachRoutes',
                          policy.outreachRoutes?.map((route) => ({ ...route, profileIds: [] })),
                        )
                      }}
                    >
                      <SelectTrigger
                        id="routine-model"
                        className="h-9 brand-focus border-line bg-field text-ink"
                      >
                        <SelectValue placeholder="Choose a model" />
                      </SelectTrigger>
                      <SelectContent className="panel-dropdown">
                        {lists.map((list) => {
                          const inUse = automations?.some(
                            (row) =>
                              row._id !== automation?._id &&
                              row.routine &&
                              row.listIds?.includes(list._id),
                          )
                          return (
                            <SelectItem key={list._id} value={list._id} disabled={inUse}>
                              {inUse ? `${list.name} (in use)` : list.name}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <ToggleRow
                  wide
                  label="Run without visible browser"
                  checked={policy.headless}
                  onChange={(checked) => change('headless', checked)}
                />
              </fieldset>
            )}

            {tab === 'warmup' && (
              <fieldset disabled={formDisabled} className="space-y-6">
                <p className="rounded-lg bg-panel-muted px-3 py-2 text-[13px] leading-5 text-copy">
                  {warmupSummary}
                </p>
                <SettingsGroup title="Schedule">
                  {rangeSetting(
                    'Daily browsing',
                    'warmup_min_minutes',
                    'warmup_max_minutes',
                    'min',
                  )}
                  {rangeSetting(
                    'Session length',
                    'session_min_minutes',
                    'session_max_minutes',
                    'min',
                  )}
                  {rangeSetting(
                    'Rest between sessions',
                    'rest_min_minutes',
                    'rest_max_minutes',
                    'min',
                  )}
                  {routineRange(
                    'warmup-posts',
                    'Warm-up posts',
                    'posts',
                    'warmupMinPosts',
                    'warmupMaxPosts',
                    100,
                    9,
                  )}
                </SettingsGroup>
                <SettingsGroup title="Engagement">
                  {percentSetting('Like', 'like_chance')}
                  {percentSetting('Follow', 'follow_chance')}
                  {percentSetting('Carousel watch', 'carousel_watch_chance')}
                  {numberSetting('Max carousel slides', 'carousel_max_slides')}
                </SettingsGroup>
                <SettingsGroup title="Feed" collapsible defaultOpen={false}>
                  {percentSetting('Skip post', 'skip_post_chance')}
                  {numberSetting('Max posts skipped', 'skip_post_max')}
                  {rangeSetting(
                    'Post view',
                    'post_view_min_seconds',
                    'post_view_max_seconds',
                    'sec',
                  )}
                </SettingsGroup>
                <SettingsGroup title="Stories" collapsible defaultOpen={false}>
                  <ToggleRow
                    wide
                    label="Watch stories before feed"
                    checked={flag('watch_stories')}
                    onChange={(checked) => setActivity({ watch_stories: checked })}
                  />
                  {numberSetting('Max stories', 'stories_max')}
                  {rangeSetting(
                    'Story view',
                    'stories_min_view_seconds',
                    'stories_max_view_seconds',
                    'sec',
                  )}
                </SettingsGroup>
                <SettingsGroup title="Explore" collapsible defaultOpen={false}>
                  {percentSetting('Profile visit', 'profile_visit_chance')}
                  {percentSetting('Visit author after like', 'liked_profile_visit_chance')}
                  {percentSetting('Own profile', 'own_profile_chance')}
                  {percentSetting('DM check', 'dm_chance')}
                  {percentSetting('Reels', 'reels_chance')}
                  {percentSetting('Reel skip', 'reels_skip_chance')}
                  {rangeSetting('Reels per session', 'reels_min', 'reels_max')}
                </SettingsGroup>
              </fieldset>
            )}

            {tab === 'outreach' && (
              <fieldset disabled={formDisabled} className="space-y-6">
                <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line-soft bg-panel p-4">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">Enable outreach</span>
                    <span className="block text-xs text-subtle-copy">{outreachSummary}</span>
                  </span>
                  <Switch
                    checked={policy.outreachEnabled}
                    onCheckedChange={(checked) => change('outreachEnabled', checked)}
                    className="shrink-0 brand-switch"
                  />
                </label>
                <div className={cn('space-y-6', !policy.outreachEnabled && 'opacity-60')}>
                  <SettingsGroup title="Daily DMs">
                    {routineNumber('outreach-start-day', 'Outreach from day', 'outreachStartDay', {
                      min: 1,
                      max: 365,
                    })}
                    {routineNumber('initial-dms', 'Initial DMs per day', 'initialDms', {
                      min: 1,
                      max: 35,
                    })}
                    {routineNumber('max-dms', 'Max DMs per day', 'maxDms', { min: 1, max: 35 })}
                  </SettingsGroup>
                  <SettingsGroup title="Unfollow">
                    {routineRange(
                      'unfollow-days',
                      'Unfollow after',
                      'days',
                      'unfollowMinDays',
                      'unfollowMaxDays',
                      365,
                      7,
                    )}
                  </SettingsGroup>
                  <OutreachAssignments
                    routes={policy.outreachRoutes ?? []}
                    lists={leadLists ?? []}
                    profiles={(profiles ?? []).filter(
                      (profile) =>
                        profile.status !== 'deleting' && profile.listIds?.includes(listIds[0]!),
                    )}
                    loading={leadLists === undefined || profiles === undefined}
                    disabled={formDisabled}
                    onChange={(routes) => change('outreachRoutes', routes)}
                  />
                </div>
              </fieldset>
            )}

            {tab === 'profiles' &&
              (automation ? (
                <RoutineProfiles automationId={automation._id} modelId={automation.listIds?.[0]} />
              ) : (
                <p className="text-sm text-subtle-copy">Save the automation to see its profiles.</p>
              ))}
          </div>
        </div>

        {tab !== 'profiles' && (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line-soft px-6 py-3">
            <p className="min-w-0 truncate text-xs text-subtle-copy">{footerNote}</p>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={() => void save()}
                disabled={!canSave}
                className="brand-button font-medium"
              >
                {saving ? 'Saving…' : automation ? 'Save changes' : 'Create automation'}
              </Button>
            </div>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Converts a feed definition's bounds into input limits.
function limitsOf(input: ActivityInput): Limits {
  return { min: input.min, max: input.max, step: input.step }
}

// Formats a min/max pair for summaries, such as "5–10" or "9". Shows ? while a value is empty.
function span(min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '?'
  return min === max ? String(min) : `${min}–${max}`
}

// Returns the first rule the routine breaks, or an empty string when it is valid.
function routineProblem(policy: RoutinePolicy) {
  try {
    validateRoutine(policy)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
