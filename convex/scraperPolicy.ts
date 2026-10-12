import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

export const DAY = 86_400_000
export const scraperBusy = (profile: Pick<Doc<'profiles'>, 'using' | 'status'>) =>
  profile.using || profile.status === 'running'

/** Read small session metadata only for accounts without browser cookies. */
export async function scraperProfiles(ctx: Pick<QueryCtx, 'db'>) {
  const initialized = await ctx.db.query('workerMetadataMigration').unique()
  if (initialized?.complete) {
    const rows = await ctx.db.query('scraperProfiles').collect()
    return rows.map(({ _id: _rowId, _creationTime: _created, profileId, ...fields }) => ({
      ...fields,
      _id: profileId as Id<'profiles'>,
    }))
  }
  const profiles = await ctx.db.query('profiles').collect()
  return Promise.all(
    profiles.map(async (profile) => {
      const session = profile.sessionId
        ? null
        : await ctx.db
            .query('chatSessions')
            .withIndex('by_profile', (q) => q.eq('profileId', profile._id))
            .first()
      return {
        ...profile,
        scraperReady: !profile.paused && (!!profile.sessionId || (!!session && !session.reconnectRequired)),
      }
    }),
  )
}

export function capacityAt(profile: Pick<Doc<'profiles'>, 'scraperCooldownUntil'>) {
  return profile.scraperCooldownUntil ?? 0
}
