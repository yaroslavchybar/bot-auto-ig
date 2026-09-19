import { useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'

type WarmupState = {
  id: string
  profileId: string
  day: number
  date: string
  runsToday: number
  todayMinutes: number
  minutesUsedToday: number
  reservedMinutes: number
  nextRunAt?: number
}

/**
 * Read-only per-profile warm-up progress shown in the Warm Up node settings:
 * current day, today's run count, and today's assigned minutes.
 */
export function WarmUpStatesTable() {
  const states = useQuery(api.warmup.queries.list, {}) as WarmupState[] | undefined
  const profiles = useQuery(api.profiles.queries.list, {}) as Array<{ _id: string; name: string }> | undefined

  if (states === undefined) {
    return <p className="text-subtle-copy text-xs">Loading warm-up progress…</p>
  }
  if (states.length === 0) {
    return (
      <p className="text-subtle-copy text-xs">
        No warm-up runs yet. Day 1 starts on the first run.
      </p>
    )
  }

  const names = new Map((profiles ?? []).map((p) => [String(p._id), p.name]))

  return (
    <div className="space-y-1">
      <p className="text-ink text-xs font-semibold">Warm-Up Progress</p>
      <div className="border-line-soft overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-panel-subtle text-subtle-copy text-left">
              <th className="px-2 py-1.5 font-medium">Profile</th>
              <th className="px-2 py-1.5 font-medium">Date (UTC)</th>
              <th className="px-2 py-1.5 text-right font-medium">Day</th>
              <th className="px-2 py-1.5 text-right font-medium">Runs</th>
              <th className="px-2 py-1.5 text-right font-medium">Budget (min)</th>
              <th className="px-2 py-1.5 text-right font-medium">Used</th>
              <th className="px-2 py-1.5 text-right font-medium">Reserved</th>
              <th className="px-2 py-1.5 font-medium">Rest Until</th>
            </tr>
          </thead>
          <tbody>
            {states.map((s) => (
              <tr key={s.id} className="border-line-soft text-ink border-t">
                <td className="max-w-[140px] truncate px-2 py-1.5">
                  {names.get(s.profileId) ?? 'Profile'}
                </td>
                <td className="px-2 py-1.5">{s.date}</td>
                <td className="px-2 py-1.5 text-right">{s.day}</td>
                <td className="px-2 py-1.5 text-right">{s.runsToday}×</td>
                <td className="px-2 py-1.5 text-right">{Math.round(s.todayMinutes)}</td>
                <td className="px-2 py-1.5 text-right">{Math.round(s.minutesUsedToday ?? 0)}</td>
                <td className="px-2 py-1.5 text-right">{Math.round(s.reservedMinutes)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-subtle-copy text-xs">
        Reserved time belongs to an active session. After a worker crash, it stays reserved until the next UTC day.
      </p>
    </div>
  )
}
