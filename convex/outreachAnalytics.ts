import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { dayKey } from './routinePolicy'

const MAX_OUTREACH_ANALYTICS_ROWS = 10_000

/** The lead's cohort pointer makes confirmed follows and later conversions count exactly once. */
export async function recordOutreachFollow(
  ctx: MutationCtx,
  lead: Doc<'leads'>,
  followedAt: number,
) {
  const profileId = lead.senderId
  if (lead.outreachDayId || !profileId) return lead.outreachDayId
  const date = dayKey(followedAt)
  const row = await ctx.db
    .query('outreachDays')
    .withIndex('by_profile_automation_date', (q) =>
      q.eq('profileId', profileId).eq('automationId', lead.outreachAutomationId).eq('date', date),
    )
    .unique()
  const profile = await ctx.db.get(profileId)
  if (row) {
    await ctx.db.patch(row._id, {
      followed: row.followed + 1,
      pending: row.pending + 1,
      profileName: profile?.name ?? row.profileName,
    })
    return row._id
  }
  return ctx.db.insert('outreachDays', {
    profileId,
    profileName: profile?.name ?? 'Removed profile',
    automationId: lead.outreachAutomationId,
    date,
    followed: 1,
    followedBack: 0,
    pending: 1,
  })
}

export async function recordOutreachFollowBack(ctx: MutationCtx, lead: Doc<'leads'>) {
  if (!lead.outreachDayId || lead.followBackAt !== undefined) return
  const row = await ctx.db.get(lead.outreachDayId)
  if (row)
    await ctx.db.patch(row._id, {
      followedBack: row.followedBack + 1,
      pending: Math.max(0, row.pending - Number(lead.followed)),
    })
}

export async function recordOutreachUnfollow(ctx: MutationCtx, lead: Doc<'leads'>) {
  if (!lead.outreachDayId || !lead.followed || lead.followBackAt !== undefined) return
  const row = await ctx.db.get(lead.outreachDayId)
  if (row) await ctx.db.patch(row._id, { pending: Math.max(0, row.pending - 1) })
}

/** Conversions belong to the original follow date, not the day the notification was read. */
export async function outreachSummary(
  ctx: QueryCtx,
  start: string | undefined,
  end: string,
  profiles: { profileId: Id<'profiles'>; name: string }[],
) {
  const rows = await ctx.db
    .query('outreachDays')
    .withIndex('by_date', (q) =>
      start ? q.gte('date', start).lte('date', end) : q.lte('date', end),
    )
    .take(MAX_OUTREACH_ANALYTICS_ROWS + 1)
  if (rows.length > MAX_OUTREACH_ANALYTICS_ROWS)
    throw new Error('Follow-back analytics snapshot is too large. Choose a shorter date range.')
  const first = await ctx.db.query('outreachDays').withIndex('by_date').first()
  const accounts = new Map(
    profiles.map((p) => [
      p.profileId,
      {
        profileId: p.profileId,
        name: p.name,
        removed: false,
        followed: 0,
        followedBack: 0,
        pending: 0,
      },
    ]),
  )
  for (const row of rows) {
    let account = accounts.get(row.profileId)
    if (!account) {
      account = {
        profileId: row.profileId,
        name: row.profileName,
        removed: true,
        followed: 0,
        followedBack: 0,
        pending: 0,
      }
      accounts.set(row.profileId, account)
    }
    account.followed += row.followed
    account.followedBack += row.followedBack
    account.pending += row.pending
  }
  const totals = [...accounts.values()].reduce(
    (sum, account) => ({
      followed: sum.followed + account.followed,
      followedBack: sum.followedBack + account.followedBack,
      pending: sum.pending + account.pending,
    }),
    { followed: 0, followedBack: 0, pending: 0 },
  )
  const rate = (followed: number, followedBack: number) =>
    followed ? (followedBack / followed) * 100 : null
  return {
    since: first?.date ?? null,
    totals: { ...totals, rate: rate(totals.followed, totals.followedBack) },
    accounts: [...accounts.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((account) => ({ ...account, rate: rate(account.followed, account.followedBack) })),
  }
}
