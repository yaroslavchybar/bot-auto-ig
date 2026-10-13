import { v } from 'convex/values'
import { internalMutation, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { proxyCountryZones } from './proxyCountryZones'
import {
  MOBILE_REQUEST_LIMIT,
  requestCapacityAt,
  requestsInHour,
  sessionWindow,
} from './mobileRequestPolicy'
import { recordActivity } from './analyticsActivity'
import { proxyKey } from './proxies'

/** Lightweight projections keep cookie blobs out of request-budget reads. */
export async function mobileRequestState(
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
      .query('mobileRequestUsage')
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
  const times = usage?.requests.map((request) => request.at) ?? []
  const window = timezone ? sessionWindow(String(profileId), timezone, now) : null
  return {
    usage,
    paused: profile.paused === true,
    country,
    timezone,
    requestTimes: times,
    hourlyLimit: MOBILE_REQUEST_LIMIT,
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
  state: Awaited<ReturnType<typeof mobileRequestState>>,
) {
  if (
    !state.sleeping ||
    state.availableAt === null ||
    state.usage?.sleepUntil === state.availableAt
  )
    return
  if (state.usage) await ctx.db.patch(state.usage._id, { sleepUntil: state.availableAt })
  else
    await ctx.db.insert('mobileRequestUsage', {
      profileId,
      requests: [],
      sleepUntil: state.availableAt,
    })
}

/** All mobile dispatches share the hourly/sleep budget. */
export const reserve = internalMutation({
  args: {
    profileId: v.id('profiles'),
    requestId: v.string(),
    manualReconnect: v.optional(v.boolean()),
  },
  handler: async (ctx, { profileId, requestId, manualReconnect }) => {
    if (!requestId || requestId.length > 100) throw new Error('Invalid request ID')
    const now = Date.now()
    const state = await mobileRequestState(ctx, profileId, now)
    // Resume is controlled by the flag; pausing must not create a one-hour login cooldown.
    if (state.paused && !manualReconnect)
      return { allowed: false, retryAt: now, reason: 'Profile is paused' }
    if (
      state.usage?.requests.some(
        (request) => request.id === requestId && request.at > now - 3_600_000,
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
          ? 'Mobile session is sleeping'
          : 'Hourly mobile request limit reached',
      }
    }
    const requests = (state.usage?.requests ?? []).filter((request) => request.at > now - 3_600_000)
    requests.push({ id: requestId, at: now })
    if (state.usage) await ctx.db.patch(state.usage._id, { requests })
    else await ctx.db.insert('mobileRequestUsage', { profileId, requests })
    await recordActivity(ctx, new Date(now).toISOString().slice(0, 10), { mobileRequests: 1 })
    return { allowed: true, retryAt: now }
  },
})
