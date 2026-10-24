import { releasedSourceRun } from '../scraperPolicy'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { leadAvailable, setLeadAvailability } from '../leadMemberships'
import { LeadStatsChanges } from '../leadStats'
import { recordOutreachUnfollow } from '../outreachAnalytics'

/** Profile-owned rows have no meaning after the browser profile is deleted. */
export async function deleteProfileData(ctx: MutationCtx, profileId: Id<'profiles'>) {
  const accounts = await ctx.db
    .query('igAccounts')
    .withIndex('by_profile', (q) => q.eq('profileId', profileId))
    .collect()
  const accountIds = new Set(accounts.map((account) => account._id))
  if (accountIds.size) {
    for (const proxy of await ctx.db.query('proxies').collect()) {
      const patch: Partial<Doc<'proxies'>> = {}
      if (proxy.loginClaim && accountIds.has(proxy.loginClaim.accountId))
        patch.loginClaim = undefined
      if (proxy.loginCooldownAccountId && accountIds.has(proxy.loginCooldownAccountId))
        patch.loginCooldownAccountId = undefined
      // Keep the proxy's actual cooldown even after its account is removed.
      if (Object.keys(patch).length) await ctx.db.patch(proxy._id, patch)
    }
  }
  for (const account of accounts) await ctx.db.delete(account._id)
  for (const table of [
    'accountProgress',
    'warmupStates',
    'modelSetupStates',
    'scraperProfiles',
    'scraperRequestUsage',
    'ownPostLikerSnapshots',
    'proxyProfileAssignments',
  ] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .collect()
    for (const row of rows) await ctx.db.delete(row._id)
  }
  for (const automation of await ctx.db.query('automations').collect()) {
    const patch: Partial<Doc<'automations'>> = {}
    const routine = automation.routine
    if (routine?.outreach?.profileIds.includes(profileId)) {
      const profileIds = routine.outreach.profileIds.filter(id => id !== profileId);
      const outreach = routine.outreach.allProfiles || profileIds.length ? { ...routine.outreach, profileIds } : undefined;
      patch.routine = { ...routine, outreach, outreachEnabled: routine.outreachEnabled && !!outreach };
    }
    if (Object.keys(patch).length)
      await ctx.db.patch(automation._id, { ...patch, updatedAt: Date.now() })
  }
  await cleanupProfileReferences(ctx, profileId)
}

/** Bound shared-data cleanup so a long-lived profile cannot exceed mutation limits. */
export async function cleanupProfileReferences(
  ctx: MutationCtx,
  profileId: Id<'profiles'>,
): Promise<void> {
  const batchSize = 100
  const senders = await ctx.db
    .query('leads')
    .withIndex('by_follow_due', (q) => q.eq('senderId', profileId))
    .take(batchSize)
  const stats = new LeadStatsChanges()
  for (const lead of senders) {
    await recordOutreachUnfollow(ctx, lead)
    const patch = {
      senderId: undefined,
      outreachListId: undefined,
      outreachAutomationId: undefined,
      dmEligible: undefined,
      followBackAt: undefined,
      postEngagement: undefined,
    }
    await ctx.db.patch(lead._id, patch)
    // Keep Follow/DM history so deleting a sender cannot cause duplicate outreach.
    const next = { ...lead, ...patch }
    stats.add(lead, next)
    await setLeadAvailability(ctx, lead._id, leadAvailable(next))
  }
  await stats.flush(ctx)
  const screenings = await ctx.db
    .query('leads')
    .withIndex('by_screening_profile', (q) => q.eq('screeningProfileId', profileId))
    .take(batchSize)
  for (const lead of screenings)
    await ctx.db.patch(lead._id, {
      screeningProfileId: undefined,
      screeningToken: undefined,
      screeningAutomationId: undefined,
      screeningListId: undefined,
      screeningUntil: undefined,
    })
  const sources = await ctx.db
    .query('scrapeSources')
    .withIndex('by_profile', (q) => q.eq('profileId', profileId))
    .take(batchSize)
  for (const source of sources)
    await ctx.db.patch(source._id, {
      profileId: undefined,
      ...releasedSourceRun,
      nextCheckAt: Math.min(source.nextCheckAt, Date.now()),
    })
  if ([senders, screenings, sources].some((rows) => rows.length === batchSize))
    await ctx.scheduler.runAfter(
      0,
      internal.profiles.mutations.cleanupDeletedProfileReferencesInternal,
      { profileId },
    )
}
