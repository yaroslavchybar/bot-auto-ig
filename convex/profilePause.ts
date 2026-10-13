import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { patchProfile } from './workerMetadata'

/** One pause switch covers browser automation, setup, scraping, and mobile calls. */
export async function setProfilePaused(
  ctx: MutationCtx,
  profileId: Id<'profiles'>,
  paused: boolean,
) {
  const profile = await ctx.db.get(profileId)
  if (!profile || profile.status === 'deleting' || profile.renameFrom)
    throw new Error('Profile unavailable')
  if (profile.paused !== paused) await patchProfile(ctx, profileId, { paused })
  const progress = await ctx.db
    .query('accountProgress')
    .withIndex('by_profile', (q) => q.eq('profileId', profileId))
    .unique()
  if (progress && progress.paused !== paused)
    await ctx.db.patch(progress._id, { paused, updatedAt: Date.now() })
  if (paused) {
    const sources = await ctx.db
      .query('scrapeSources')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId).eq('running', true))
      .collect()
    for (const source of sources)
      if (source.running)
        await ctx.db.patch(source._id, {
          running: false,
          runId: undefined,
          leaseUntil: undefined,
          kind: undefined,
          currentPostId: undefined,
        })
  }
}
