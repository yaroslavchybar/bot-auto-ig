import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { OUTREACH_MIN_POSTS } from '../../../../../convex/routinePolicy'
import { apiFetch } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { IgStateToggles } from './IgStateToggles'

type Details = NonNullable<FunctionReturnType<typeof api.routines.profileDetails>>

export function ProfileDetailsDialog({
  profile,
  onClose,
}: {
  profile: { id: string; name: string }
  onClose: () => void
}) {
  const details = useQuery(api.routines.profileDetails, { profileId: profile.id as Id<'profiles'> })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[640px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="page-title-gradient">{details?.name ?? profile.name}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {details === undefined ? (
            <p role="status" className="py-4 text-sm text-subtle-copy">
              Loading profile details…
            </p>
          ) : details === null ? (
            <p role="status" className="py-4 text-sm text-subtle-copy">
              This profile no longer exists.
            </p>
          ) : (
            <ProfileDetails key={details.profileId} details={details} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProfileDetails({ details }: { details: Details }) {
  const setPaused = useMutation(api.profiles.mutations.setPaused)
  const setAccount = useMutation(api.routines.setAccount)
  const [busy, setBusy] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const { setup } = details
  const status = details.paused
    ? 'Paused'
    : details.issue || setup?.error || setup?.pending
      ? 'Needs attention'
      : details.stage

  const update = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const reconcile = async (resolution: 'completed' | 'failed') => {
    if (
      resolution === 'failed' &&
      !window.confirm(
        'Confirm this action did not succeed in Instagram. Retrying a successful post would publish it twice.',
      )
    )
      return
    setReviewing(true)
    try {
      await apiFetch(`/api/ig-accounts/warmup/${details.profileId}/reconcile`, {
        method: 'POST',
        body: { resolution },
      })
      toast.success(resolution === 'completed' ? 'Action marked complete' : 'Action ready to retry')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="space-y-5 pb-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge
          variant="outline"
          className={cn(
            'text-xs',
            status === 'Needs attention'
              ? 'border-status-danger-border bg-status-danger-soft text-status-danger'
              : details.paused
                ? 'border-line bg-panel-muted text-copy'
                : details.stage === 'Outreach'
                  ? 'border-status-success-border bg-status-success-soft text-status-success'
                  : details.stage === 'Not logged in'
                    ? 'border-status-warning-border bg-status-warning-soft text-status-warning'
                    : 'border-status-info-border bg-status-info-soft text-status-info',
          )}
        >
          {status}
        </Badge>
        <Button
          variant="outline"
          disabled={busy || details.changing}
          onClick={() =>
            void update(() => setPaused({ profileId: details.profileId, paused: !details.paused }))
          }
        >
          {details.paused ? 'Resume profile' : 'Pause profile'}
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-line-soft bg-panel-subtle p-4 text-sm">
        {[
          ['Model', details.model?.name ?? 'Not assigned'],
          [
            'Automation',
            details.automation
              ? `${details.automation.name}${details.automation.enabled ? '' : ' (disabled)'}`
              : 'Not assigned',
          ],
          ['Browser', details.browserStatus],
          ['Instagram', details.igLoggedIn ? 'Logged in' : 'Not logged in'],
          ['Active days', details.activeDays],
          [
            'Next session',
            details.nextRunAt ? new Date(details.nextRunAt).toLocaleString() : 'Not scheduled',
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-subtle-copy">{label}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-3 font-medium break-words text-ink">
              {value}
              {label === 'Instagram' && <IgStateToggles disabled={details.changing}
                profile={{ id: details.profileId, name: details.name, igLoggedIn: details.igLoggedIn }} />}
            </dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Daily outreach</h3>
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-copy">
          <Meter label="Outreach" done={details.used} total={details.allowance} />
          <span>{details.followed} follows</span>
          <span>{details.sent} DMs sent</span>
          {details.budgetExhausted && <Badge variant="outline">Time budget used</Badge>}
        </div>
      </section>

      {details.issue && (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-status-danger-border bg-status-danger-soft p-4"
        >
          <p className="text-sm text-status-danger">{details.issue}</p>
          <Button
            variant="outline"
            disabled={busy || details.changing}
            onClick={() =>
              void update(() => setAccount({ profileId: details.profileId, clearIssue: true }))
            }
          >
            Mark resolved
          </Button>
        </div>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Setup progress</h3>
        {setup ? (
          <SetupSteps
            progress={setup}
            reviewing={reviewing || details.changing}
            onReview={(resolution) => void reconcile(resolution)}
          />
        ) : (
          <p className="text-sm text-subtle-copy">Setup has not started.</p>
        )}
      </section>
    </div>
  )
}

function Meter({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="tabular-nums">
        {label} {done}/{total}
      </span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-muted">
        <span
          className="block h-full rounded-full bg-status-success"
          style={{ width: `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%` }}
        />
      </span>
    </span>
  )
}

function SetupSteps({
  progress,
  reviewing,
  onReview,
}: {
  progress: NonNullable<Details['setup']>
  reviewing: boolean
  onReview: (resolution: 'completed' | 'failed') => void
}) {
  const postTarget = progress.postTarget ?? 9
  const steps = [
    { label: 'Username', done: progress.usernameDone === true },
    { label: 'Full name', done: progress.fullNameDone === true },
    { label: 'Avatar', done: progress.avatarDone === true },
    { label: `Posts ${progress.postsDone}/${postTarget}`, done: progress.postsDone >= postTarget },
    {
      label: `${OUTREACH_MIN_POSTS} posts for Outreach`,
      done: progress.postsDone >= OUTREACH_MIN_POSTS,
    },
  ]
  return (
    <div className="space-y-3">
      <Meter label="Setup" done={steps.filter((step) => step.done).length} total={steps.length} />
      <div className="flex flex-wrap gap-1.5">
        {steps.map((step) => (
          <span
            key={step.label}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs',
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
      {progress.error && (
        <p role="alert" className="text-sm text-status-danger">
          {progress.error}
        </p>
      )}
      {progress.pending && (
        <div className="space-y-2 rounded-lg bg-status-warning-soft p-3">
          <p className="text-sm text-copy">
            Did this {progress.pending.kind} succeed on Instagram?
          </p>
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
