import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

export const SCREENING_FAILURE_LIMIT = 3

/** Started or completed outreach must never return to the new-lead pool. */
export const hasOutreachHistory = (
  lead: Pick<
    Doc<'leads'>,
    | 'senderId'
    | 'dmSent'
    | 'followed'
    | 'dmBlocked'
    | 'followStartedAt'
    | 'followDate'
    | 'unfollowAt'
    | 'dmStartedAt'
  >,
) =>
  !!(
    lead.senderId ||
    lead.followed ||
    lead.dmSent ||
    lead.dmBlocked ||
    lead.followStartedAt !== undefined ||
    lead.followDate !== undefined ||
    lead.unfollowAt !== undefined ||
    lead.dmStartedAt !== undefined
  )

export const leadAvailable = (
  lead: Pick<
    Doc<'leads'>,
    | 'classification'
    | 'enrichmentStatus'
    | 'senderId'
    | 'dmSent'
    | 'followed'
    | 'dmBlocked'
    | 'followStartedAt'
    | 'followDate'
    | 'unfollowAt'
    | 'dmStartedAt'
    | 'screeningFailures'
  >,
) =>
  (lead.screeningFailures ?? 0) < SCREENING_FAILURE_LIMIT &&
  !(lead.enrichmentStatus === 'ready' && !lead.classification) &&
  !hasOutreachHistory(lead)

/** Keep all of a lead's list indexes in sync with its outreach state. */
export async function setLeadAvailability(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  available: boolean,
): Promise<void> {
  const lead = await ctx.db.get(leadId)
  const memberships = await ctx.db
    .query('leadMemberships')
    .withIndex('by_lead_list', (q) => q.eq('leadId', leadId))
    .collect()
  await Promise.all(
    memberships
      .filter((row) => row.available !== available || row.classification !== lead?.classification)
      .map((row) => ctx.db.patch(row._id, { available, classification: lead?.classification })),
  )
}

/** One row per lead/list pair, with availability matching the lead. */
export async function addMembership(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  listId: Id<'leadLists'>,
  leadCreatedAt: number,
  available: boolean,
  classification?: Doc<'leads'>['classification'],
): Promise<void> {
  const existing = await ctx.db
    .query('leadMemberships')
    .withIndex('by_lead_list', (q) => q.eq('leadId', leadId).eq('listId', listId))
    .first()
  if (existing) {
    if (existing.available !== available || existing.classification !== classification)
      await ctx.db.patch(existing._id, { available, classification })
    return
  }
  await ctx.db.insert('leadMemberships', {
    leadId,
    listId,
    leadCreatedAt,
    available,
    classification,
  })
  const counter = await ctx.db
    .query('leadListCounts')
    .withIndex('by_list', (q) => q.eq('listId', listId))
    .unique()
  if (counter?.count !== undefined) {
    await ctx.db.patch(counter._id, { count: counter.count + 1 })
  } else if (counter) {
    // A concurrent insert invalidates an in-progress backfill's snapshot.
    await ctx.db.patch(counter._id, { revision: (counter.revision ?? 0) + 1 })
  }
}
