import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

export const leadAvailable = (lead: Doc<'leads'>) =>
  lead.classification === 'male' && lead.enrichmentStatus === 'ready' &&
  !lead.senderId && !lead.dmSent && !lead.followed;

/** Keep all of a lead's list indexes in sync with its outreach state. */
export async function setLeadAvailability(ctx: MutationCtx, leadId: Id<'leads'>, available: boolean): Promise<void> {
  const memberships = await ctx.db.query('leadMemberships')
    .withIndex('by_lead_list', q => q.eq('leadId', leadId)).collect();
  await Promise.all(memberships.filter(row => row.available !== available)
    .map(row => ctx.db.patch(row._id, { available })));
}

/** One row per lead/list pair, with availability matching the lead. */
export async function addMembership(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  listId: Id<'leadLists'>,
  leadCreatedAt: number,
  available: boolean,
): Promise<void> {
  const existing = await ctx.db.query('leadMemberships')
    .withIndex('by_lead_list', q => q.eq('leadId', leadId).eq('listId', listId)).first();
  if (existing) {
    if (existing.available !== available) await ctx.db.patch(existing._id, { available });
    return;
  }
  await ctx.db.insert('leadMemberships', { leadId, listId, leadCreatedAt, available });
  const counter = await ctx.db.query('leadListCounts')
    .withIndex('by_list', q => q.eq('listId', listId)).unique();
  if (counter?.count !== undefined) {
    await ctx.db.patch(counter._id, { count: counter.count + 1 });
  } else if (counter) {
    // A concurrent insert invalidates an in-progress backfill's snapshot.
    await ctx.db.patch(counter._id, { revision: (counter.revision ?? 0) + 1 });
  }
}
