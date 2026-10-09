import type { Doc } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { DEFAULT_SCRAPER_DAILY_LIMIT } from './scraperKeys'

export const DAY = 86_400_000
export const day = () => new Date().toISOString().slice(0, 10)
export const limitFor = (profile: Doc<'profiles'>) =>
  profile.scraperDailyLimit === null
    ? undefined
    : (profile.scraperDailyLimit ?? DEFAULT_SCRAPER_DAILY_LIMIT)
export const usedToday = (profile: Doc<'profiles'>) =>
  profile.scraperUsageDate === day() ? (profile.scraperUsageCount ?? 0) : 0

/** Read small session metadata only for accounts without browser cookies. */
export async function scraperProfiles(ctx: Pick<QueryCtx, 'db'>) {
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

export function capacityAt(profile: Doc<'profiles'>) {
  const limit = limitFor(profile)
  const reset =
    limit !== undefined && (profile.scraperUsageCount ?? 0) >= limit && profile.scraperUsageDate
      ? Date.parse(`${profile.scraperUsageDate}T00:00:00Z`) + DAY
      : 0
  return Math.max(profile.scraperCooldownUntil ?? 0, reset)
}
