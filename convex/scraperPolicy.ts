import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { DEFAULT_SCRAPER_DAILY_LIMIT } from './scraperKeys'

export const DAY = 86_400_000
export const day = () => new Date().toISOString().slice(0, 10)
export const limitFor = (profile: Pick<Doc<'profiles'>, 'scraperDailyLimit'>) =>
  profile.scraperDailyLimit === null
    ? undefined
    : (profile.scraperDailyLimit ?? DEFAULT_SCRAPER_DAILY_LIMIT)
export const usedToday = (profile: Pick<Doc<'profiles'>, 'scraperUsageDate' | 'scraperUsageCount'>) =>
  profile.scraperUsageDate === day() ? (profile.scraperUsageCount ?? 0) : 0
export const scraperBusy = (profile: Pick<Doc<'profiles'>, 'using' | 'status'>) =>
  profile.using || profile.status === 'running'

/** Read small session metadata only for accounts without browser cookies. */
export async function scraperProfiles(ctx: Pick<QueryCtx, 'db'>) {
  const initialized = await ctx.db.query('workerMetadataMigration').unique()
  if (initialized?.complete) {
    const rows = await ctx.db.query('scraperProfiles').collect()
    return rows.map(({ _id: _rowId, _creationTime: _created, profileId, ...fields }) => ({ ...fields, _id: profileId as Id<'profiles'> }))
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
        scraperReady: !!profile.sessionId || (!!session && !session.reconnectRequired),
      }
    }),
  )
}

export function capacityAt(profile: Pick<Doc<'profiles'>, 'scraperDailyLimit' | 'scraperUsageDate' | 'scraperUsageCount' | 'scraperCooldownUntil'>) {
  const limit = limitFor(profile)
  const reset =
    limit !== undefined && (profile.scraperUsageCount ?? 0) >= limit && profile.scraperUsageDate
      ? Date.parse(`${profile.scraperUsageDate}T00:00:00Z`) + DAY
      : 0
  return Math.max(profile.scraperCooldownUntil ?? 0, reset)
}
