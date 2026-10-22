import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../../convex/_generated/api'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type Outreach = FunctionReturnType<typeof api.analytics.overview>['outreach']
const percentage = (rate: number | null) =>
  rate === null ? '—' : `${rate.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`

export function FollowBackAnalytics({ data }: { data: Outreach }) {
  return (
    <section
      className="rounded-2xl border border-line-soft bg-panel p-4"
      aria-label="Follow-back analytics"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Follow-back rate</h2>
          <p className="mt-1 text-xs text-subtle-copy">
            Grouped by when we followed each lead. Recent follows may still get a response.
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-medium tabular-nums">{percentage(data.totals.rate)}</p>
          <p className="text-xs text-muted-copy">
            {data.totals.followedBack.toLocaleString()} followed back /{' '}
            {data.totals.followed.toLocaleString()} followed
          </p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Followed</TableHead>
            <TableHead className="text-right">Followed back</TableHead>
            <TableHead className="text-right">Pending</TableHead>
            <TableHead className="text-right">Rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.accounts.map((account) => (
            <TableRow key={account.profileId}>
              <TableCell className="font-medium">
                {account.name}
                {account.removed && <span className="ml-2 text-xs text-subtle-copy">Removed</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {account.followed.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {account.followedBack.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {account.pending.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">{percentage(account.rate)}</TableCell>
            </TableRow>
          ))}
          {!data.accounts.length && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-copy">
                No outreach accounts yet.
              </TableCell>
            </TableRow>
          )}
          <TableRow className="font-medium">
            <TableCell>Combined</TableCell>
            <TableCell className="text-right tabular-nums">
              {data.totals.followed.toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {data.totals.followedBack.toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {data.totals.pending.toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {percentage(data.totals.rate)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p className="mt-3 text-xs text-subtle-copy">
        {data.since
          ? `Tracking new outreach follows since ${data.since} (UTC).`
          : 'Tracking starts with new outreach follows.'}{' '}
        Earlier activity is not included. Pending means still followed without a detected
        follow-back.
      </p>
    </section>
  )
}
