import { v } from 'convex/values'
import { internalMutation, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { proxyCountryZones } from './proxyCountryZones'
import {
  SCRAPER_REQUEST_LIMIT,
  requestCapacityAt,
  requestsInHour,
  sessionWindow,
} from './scraperRequestPolicy'
import { recordActivity } from './analyticsActivity'
import { proxyKey } from './proxies'
import { activeSource } from './scrapeSources'

/** Lightweight projections keep cookie blobs out of request-budget reads. */
export async function scraperRequestState(
  ctx: Pick<QueryCtx, 'db'>,
  profileId: Id<'profiles'>,
  now = Date.now(),
) {
  const [metadata, usage] = await Promise.all([
    ctx.db
      .query('scraperProfiles')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .unique(),
    ctx.db
      .query('scraperRequestUsage')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .unique(),
  ])
  const profile = metadata?.proxy !== undefined ? metadata : await ctx.db.get(profileId)
  if (!profile) throw new Error('Profile not found')
  const key = proxyKey(profile.proxy, profile.proxyType)
  let proxy = key
    ? await ctx.db
        .query('proxies')
        .withIndex('by_proxy', (q) => q.eq('proxy', key))
        .first()
    : null
  if (!proxy && key && profile.proxy)
    proxy =
      (
        await ctx.db
          .query('proxies')
          .withIndex('by_proxy', (q) => q.eq('proxy', profile.proxy!))
          .take(10)
      ).find((row) => proxyKey(row.proxy, row.proxyType) === key) ?? null
  const country = proxy?.country?.toLowerCase()
  const timezone = country ? proxyCountryZones[country] : undefined
  const times = usage?.requests.map((request) => request.reservedAt) ?? []
  const window = timezone ? sessionWindow(String(profileId), timezone, now) : null
  return {
    usage,
    paused: profile.paused === true,
    blocked:
      profile.inUse ||
      profile.status === 'running' ||
      profile.status === 'deleting' ||
      !!profile.pendingRenameFrom,
    country,
    timezone,
    requestTimes: times,
    hourlyLimit: SCRAPER_REQUEST_LIMIT,
    used: requestsInHour(times, now).length,
    wakeMinute: window?.wakeMinute,
    sleeping: window?.sleeping ?? false,
    availableAt: timezone
      ? Math.max(window!.sleeping ? window!.availableAt : 0, requestCapacityAt(times))
      : null,
  }
}

/** Publish a sleep boundary once so cached work subscriptions wake at the local morning. */
export async function publishSleep(
  ctx: MutationCtx,
  profileId: Id<'profiles'>,
  state: Awaited<ReturnType<typeof scraperRequestState>>,
) {
  if (
    !state.sleeping ||
    state.availableAt === null ||
    state.usage?.sleepUntil === state.availableAt
  )
    return
  if (state.usage) await ctx.db.patch(state.usage._id, { sleepUntil: state.availableAt })
  else
    await ctx.db.insert('scraperRequestUsage', {
      profileId,
      requests: [],
      sleepUntil: state.availableAt,
    })
}

/** Each browser-cookie HTTP attempt consumes one slot; Apify and browser login do not. */
export const reserve = internalMutation({
  args: {
    profileId: v.id('profiles'),
    requestId: v.string(),
    sourceId: v.optional(v.id('scrapeSources')),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, { profileId, requestId, sourceId, runId }) => {
    if (!requestId || requestId.length > 100) throw new Error('Invalid request ID')
    const now = Date.now()
    const state = await scraperRequestState(ctx, profileId, now)
    if (state.paused) return { allowed: false, retryAt: now, reason: 'Profile is paused' }
    if (state.blocked)
      return { allowed: false, retryAt: now, reason: 'Scraper profile is busy in the browser' }
    if (sourceId) {
      if (!runId) throw new Error('Missing scraper run ID')
      const source = await activeSource(ctx, sourceId, runId, 'likers')
      if (source.profileId !== profileId) throw new Error('Scraper profile changed')
    }
    if (
      state.usage?.requests.some(
        (request) => request.id === requestId && request.reservedAt > now - 3_600_000,
      )
    )
      return { allowed: true, retryAt: now }
    if (state.availableAt === null)
      return {
        allowed: false,
        retryAt: now + 3_600_000,
        reason: 'Set the country on this session’s saved proxy',
      }
    if (state.availableAt > now) {
      await publishSleep(ctx, profileId, state)
      return {
        allowed: false,
        retryAt: state.availableAt,
        reason: state.sleeping
          ? 'Browser session is sleeping'
          : 'Hourly scraper request limit reached',
      }
    }
    const requests = (state.usage?.requests ?? []).filter((request) => request.reservedAt > now - 3_600_000)
    requests.push({ id: requestId, reservedAt: now })
    if (state.usage) await ctx.db.patch(state.usage._id, { requests })
    else await ctx.db.insert('scraperRequestUsage', { profileId, requests })
    await recordActivity(ctx, new Date(now).toISOString().slice(0, 10), { scraperRequests: 1 })
    return { allowed: true, retryAt: now }
  },
})
