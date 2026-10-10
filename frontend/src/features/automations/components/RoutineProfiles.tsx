import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { apiFetch } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Setup progress for one profile, as returned by the warm-up endpoint.
type ModelWarmup = {
  profileId: string
  modelId: string
  startedAt: number
  nameDone?: boolean
  fullNameDone?: boolean
  avatarDone?: boolean
  postSourceIds: string[]
  postTarget?: number
  pending?: { kind: string }
  error?: string
}

// Badge colors for each stage. Stages not listed here use the neutral style.
const stageTones: Record<string, string> = {
  Outreach: 'border-status-success-border bg-status-success-soft text-status-success',
  'Warm-up': 'border-status-info-border bg-status-info-soft text-status-info',
  'Not logged in': 'border-status-warning-border bg-status-warning-soft text-status-warning',
}
const neutralTone = 'border-line bg-panel-muted text-copy'

// Paused wins over an issue, and an issue wins over the stage. Used for badges and the summary.
function statusOf(row: { paused: boolean; issue?: string }) {
  return row.paused ? 'paused' : row.issue ? 'attention' : 'active'
}

// Lists the model's profiles with live status, setup progress, and pause/resume controls.
export function RoutineProfiles({
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

  // Polls setup progress for this model every 30 seconds.
  useEffect(() => {
    if (!modelId) return
    let active = true
    const refresh = () => {
      void apiFetch<ModelWarmup[]>('/api/ig-accounts/warmup')
        .then((result) => {
          if (active) {
            setWarmups(result.filter((item) => item.modelId === modelId))
            setWarmupError('')
          }
        })
        .catch((error) => {
          if (active) setWarmupError(error instanceof Error ? error.message : String(error))
        })
    }
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [modelId])

  // Runs a profile update and shows any error as a toast.
  const mutate = async (args: Parameters<typeof setAccount>[0]) => {
    try {
      await setAccount(args)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  // Resolves a stuck action after the user checks Instagram. Retrying can publish twice, so failures are confirmed first.
  const reconcile = async (profileId: string, resolution: 'completed' | 'failed') => {
    if (
      resolution === 'failed' &&
      !window.confirm(
        'Confirm this action did not succeed in Instagram. Retrying a successful post would publish it twice.',
      )
    )
      return
    setReviewing(profileId)
    try {
      await apiFetch(`/api/ig-accounts/warmup/${profileId}/reconcile`, {
        method: 'POST',
        body: { resolution },
      })
      const result = await apiFetch<ModelWarmup[]>('/api/ig-accounts/warmup')
      setWarmups(result.filter((item) => item.modelId === modelId))
      toast.success(resolution === 'completed' ? 'Action marked complete' : 'Action ready to retry')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setReviewing(null)
    }
  }

  if (!rows)
    return (
      <div className="space-y-3" role="status">
        <span className="sr-only">Loading profiles</span>
        {[0, 1].map((item) => (
          <div
            key={item}
            className="h-24 animate-pulse rounded-xl border border-line-soft bg-panel-muted"
          />
        ))}
      </div>
    )
  if (!rows.length)
    return (
      <p className="rounded-xl border border-dashed border-line-soft p-6 text-center text-sm text-subtle-copy">
        No profiles in this model yet.
      </p>
    )

  const counts = { active: 0, paused: 0, attention: 0 }
  for (const row of rows) counts[statusOf(row)]++

  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle-copy tabular-nums">
        {counts.active} active · {counts.paused} paused · {counts.attention} need attention
      </p>
      {warmupError && (
        <p role="alert" className="text-xs text-status-danger">
          Setup progress unavailable: {warmupError}
        </p>
      )}
      {rows.map((row) => {
        const progress = warmups.find((item) => item.profileId === row.profileId)
        const status = statusOf(row)
        return (
          <article
            key={row.profileId}
            className="space-y-3 rounded-xl border border-line-soft bg-panel p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="min-w-0 truncate text-sm font-semibold text-ink">{row.name}</h4>
              <Badge
                variant="outline"
                className={cn(
                  'border text-[10px] tracking-[0.18em] uppercase',
                  status === 'paused'
                    ? neutralTone
                    : status === 'attention'
                      ? 'border-status-danger-border bg-status-danger-soft text-status-danger'
                      : (stageTones[row.stage] ?? neutralTone),
                )}
              >
                {status === 'paused'
                  ? 'Paused'
                  : status === 'attention'
                    ? 'Needs attention'
                    : row.stage}
              </Badge>
              <div className="ml-auto flex items-center gap-2">
                {row.issue && (
                  <Button
                    variant="outline"
                    onClick={() => void mutate({ profileId: row.profileId, clearIssue: true })}
                  >
                    Mark resolved
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => void mutate({ profileId: row.profileId, paused: !row.paused })}
                >
                  {row.paused ? 'Resume' : 'Pause'}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-copy">
              <span className="tabular-nums">{row.activeDays} active days</span>
              {row.allowance > 0 && <Meter label="DMs" done={row.sent} total={row.allowance} />}
              {row.budgetExhausted && row.sent < row.allowance && (
                <Badge variant="outline" className="text-[10px] tracking-[0.12em] uppercase">
                  Time budget used
                </Badge>
              )}
              {row.nextRunAt && (
                <span>Next session {new Date(row.nextRunAt).toLocaleString()}</span>
              )}
            </div>

            {progress && (
              <SetupSteps
                progress={progress}
                reviewing={reviewing === row.profileId}
                onReview={(resolution) => void reconcile(String(row.profileId), resolution)}
              />
            )}

            {row.issue && <p className="text-xs text-status-danger">{row.issue}</p>}
          </article>
        )
      })}
    </div>
  )
}

// Count with a thin bar, used for daily DMs and setup steps.
function Meter({ label, done, total }: { label: string; done: number; total: number }) {
  const width = total > 0 ? Math.min(100, (done / total) * 100) : 0
  return (
    <span className="flex items-center gap-2">
      <span className="tabular-nums">
        {label} {done}/{total}
      </span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-muted">
        <span
          className="block h-full rounded-full bg-status-success"
          style={{ width: `${width}%` }}
        />
      </span>
    </span>
  )
}

// Setup checklist for one profile. Asks for a manual check when an action needs review.
function SetupSteps({
  progress,
  reviewing,
  onReview,
}: {
  progress: ModelWarmup
  reviewing: boolean
  onReview: (resolution: 'completed' | 'failed') => void
}) {
  const postTarget = progress.postTarget ?? 9
  const postsDone = progress.postSourceIds.length
  const steps = [
    { label: 'Username', done: progress.nameDone === true },
    { label: 'Full name', done: progress.fullNameDone === true },
    { label: 'Avatar', done: progress.avatarDone === true },
    { label: `Posts ${postsDone}/${postTarget}`, done: postsDone >= postTarget },
  ]
  const doneCount = steps.filter((step) => step.done).length
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Meter label="Setup" done={doneCount} total={steps.length} />
        <div className="flex flex-wrap gap-1.5">
          {steps.map((step) => (
            <span
              key={step.label}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs',
                step.done
                  ? 'bg-status-success-soft text-status-success'
                  : 'bg-panel-muted text-subtle-copy',
              )}
            >
              {step.done && <Check className="h-3 w-3" />}
              {step.label}
            </span>
          ))}
        </div>
      </div>
      {progress.error && <p className="text-xs text-status-danger">{progress.error}</p>}
      {progress.pending && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-warning-soft px-3 py-2">
          <span className="text-xs text-copy">
            Did this {progress.pending.kind} succeed on Instagram?
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={reviewing} onClick={() => onReview('completed')}>
              Succeeded
            </Button>
            <Button variant="outline" disabled={reviewing} onClick={() => onReview('failed')}>
              Failed, retry
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
