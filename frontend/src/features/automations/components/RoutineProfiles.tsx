import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../../../convex/_generated/api'
import { useNow } from '@/hooks/use-now'

const minutes = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 })

export function RoutineProfiles({
  profiles,
  enabled,
}: {
  profiles: FunctionReturnType<typeof api.routines.accounts> | undefined
  enabled: boolean
}) {
  const now = useNow()
  const today = new Date(now).toISOString().slice(0, 10)
  const tomorrow = Date.parse(`${today}T00:00:00Z`) + 86_400_000
  if (!profiles)
    return (
      <p role="status" className="text-sm text-subtle-copy">
        Loading profiles…
      </p>
    )
  if (!profiles.length)
    return <p className="text-sm text-subtle-copy">No profiles in this model yet.</p>
  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle-copy">Today (UTC)</p>
      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line-soft">
        {profiles.map((profile) => {
          const budget = profile.dailyBudget?.date === today ? profile.dailyBudget : null
          const nextRun = !enabled
            ? 'Automation off'
            : profile.paused
              ? 'Paused'
              : profile.issue
                ? 'Needs attention'
                : profile.stage === 'Not logged in'
                  ? 'Not logged in'
                  : profile.nextRunAt >= tomorrow
                    ? 'Not scheduled today'
                    : profile.nextRunAt > now
                      ? new Date(profile.nextRunAt).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : 'Due now'
          return (
            <li
              key={profile.profileId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="font-medium text-ink">{profile.name}</span>
              <div className="text-right text-xs text-subtle-copy">
                {budget ? (
                  <>
                    <p>
                      <span className="font-medium text-ink">
                        {minutes(budget.total)} min budget
                      </span>{' '}
                      · {minutes(budget.remaining)} min left
                    </p>
                    {budget.running ? (
                      <p className="mt-1">Session running</p>
                    ) : (
                      budget.remaining > 0 && <p className="mt-1">Next run: {nextRun}</p>
                    )}
                  </>
                ) : (
                  <p>Today's budget not planned yet</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-subtle-copy">Minutes update after each session.</p>
    </div>
  )
}
