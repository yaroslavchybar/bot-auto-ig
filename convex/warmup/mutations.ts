import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { planFromConfig, randomMinutes, todayDate, warmupActivityValidator } from './helpers'
import { emptyWarmupActivity, warmupActivityPlan } from '../../server/shared/warmupPlan'
import { recordActivity } from '../analyticsActivity'
import { routineLists } from '../routinePolicy'
import { proxyKey } from '../../server/shared/proxy'
import { proxyCountryZones } from '../proxyCountryZones'

/** Assign today's budget once and reserve one session, capped by remaining time. */
export const beginRunInternal = internalMutation({
  args: {
    profileId: v.id('profiles'), automationId: v.string(), runId: v.string(),
    minMinutes: v.number(), maxMinutes: v.number(),
    sessionMinMinutes: v.number(), sessionMaxMinutes: v.number(),
    restMinMinutes: v.number(), restMaxMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    for (const [min, max, floor] of [
      [args.minMinutes, args.maxMinutes, 1],
      [args.sessionMinMinutes, args.sessionMaxMinutes, 1],
      [args.restMinMinutes, args.restMaxMinutes, 0],
    ]) {
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < floor || max < min)
        throw new Error('Invalid warm-up range')
    }
    const profile = await ctx.db.get(args.profileId)
    if (!profile) throw new Error('Profile not found')
    if (profile.paused) return { date: todayDate(Date.now()), minutes: 0 }
    const now = Date.now()
    const date = todayDate(now)
    let state = await ctx.db.query('warmupStates')
      .withIndex('by_profile', q => q.eq('profileId', args.profileId)).unique()
    if (!state || state.date !== date) {
      const plan = planFromConfig({ warmup_min_minutes: args.minMinutes, warmup_max_minutes: args.maxMinutes })
      const day = state ? state.day + (state.runsToday > 0 || state.activeRun ? 1 : 0) : 1
      const daily = {
        profileId: args.profileId,
        day,
        activityPlan: warmupActivityPlan(day), activityUsed: emptyWarmupActivity(), followAttempts: [],
        date, runsToday: 0, todayMinutes: day > 7 && Math.random() < 0.1 ? 0 : randomMinutes(plan), minutesUsedToday: 0,
        recentRunIds: [] as string[], updatedAt: now,
      }
      if (state) {
        await ctx.db.patch(state._id, { ...daily, activeRun: undefined })
        state = (await ctx.db.get(state._id))!
      } else {
        state = (await ctx.db.get(await ctx.db.insert('warmupStates', daily)))!
      }
    }
    if (!state.activeRun && (state.nextRunAt ?? 0) > now) return { date, minutes: 0 }
    if (!state.activityPlan || state.activityPlan.follows === undefined || state.activityPlan.saves === undefined) {
      const activityPlan = warmupActivityPlan(state.day)
      const activityUsed = { ...emptyWarmupActivity(), ...state.activityUsed }
      for (const key of Object.keys(activityUsed) as Array<keyof typeof activityUsed>)
        if (key !== 'stories' && key !== 'reels') activityUsed[key] = Math.min(activityPlan[key], activityUsed[key])
      await ctx.db.patch(state._id, { activityPlan, activityUsed, followAttempts: state.followAttempts ?? [] })
      state = (await ctx.db.get(state._id))!
    }
    const key = proxyKey(profile.proxy, profile.proxyType)
    const proxy = key ? await ctx.db.query('proxies').withIndex('by_proxy', q => q.eq('proxy', key)).first() : null
    const timezone = proxy?.country ? proxyCountryZones[proxy.country.toLowerCase()] : undefined
    const activity = { day: state.day, activityPlan: state.activityPlan!, activityUsed: state.activityUsed ?? emptyWarmupActivity(), timezone }
    if (state.recentRunIds?.includes(args.runId)) return { date, minutes: 0 }
    if (state.activeRun) {
      return { date, minutes: state.activeRun.id === args.runId ? state.activeRun.minutes : 0,
        remainingMinutes: Math.max(0, state.todayMinutes - (state.minutesUsedToday ?? 0)), ...activity }
    }
    if ((state.nextRunAt ?? 0) > now) return { date, minutes: 0 }
    const minutes = Math.min(
      randomMinutes({ minMinutes: args.sessionMinMinutes, maxMinutes: args.sessionMaxMinutes }),
      Math.max(0, state.todayMinutes - (state.minutesUsedToday ?? 0)),
    )
    if (minutes > 0) await ctx.db.patch(state._id, {
      activeRun: { id: args.runId, minutes,
        restMinutes: randomMinutes({ minMinutes: args.restMinMinutes, maxMinutes: args.restMaxMinutes }) },
      lastAutomationId: args.automationId, updatedAt: now,
    })
    return { date, minutes, remainingMinutes: Math.max(0, state.todayMinutes - (state.minutesUsedToday ?? 0)), ...activity }
  },
})

/** Finish the reservation once. Late results never consume the next day's budget. */
export const finishRunInternal = internalMutation({
  args: { profileId: v.id('profiles'), runId: v.string(), date: v.string(), minutes: v.number(), activity: v.optional(warmupActivityValidator) },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.minutes) || args.minutes < 0) throw new Error('Invalid elapsed minutes')
    if (args.activity && Object.values(args.activity).some(value => !Number.isSafeInteger(value) || value < 0))
      throw new Error('Invalid warm-up activity counts')
    const state = await ctx.db.query('warmupStates')
      .withIndex('by_profile', q => q.eq('profileId', args.profileId)).unique()
    if (!state || state.date !== args.date || state.recentRunIds?.includes(args.runId)) return
    if (state.activeRun?.id !== args.runId) throw new Error('Warm-up reservation not found')
    const minutes = Math.min(args.minutes, state.activeRun.minutes)
    const usedMinutes = Math.min(state.todayMinutes, (state.minutesUsedToday ?? 0) + minutes)
    const activityUsed = { ...emptyWarmupActivity(), ...state.activityUsed }
    for (const key of Object.keys(activityUsed) as Array<keyof typeof activityUsed>) {
      // Follow attempts were already persisted before their browser clicks.
      if (key === 'follows') continue
      const completed = activityUsed[key] + (args.activity?.[key] ?? 0)
      // Stories and Reels have time limits; their actual view counts have no daily ceiling.
      activityUsed[key] = key === 'stories' || key === 'reels' ? completed : Math.min(state.activityPlan?.[key] ?? 0, completed)
    }
    await recordActivity(ctx, args.date, { warmupMinutes: usedMinutes - (state.minutesUsedToday ?? 0) })
    await ctx.db.patch(state._id, {
      activeRun: undefined,
      nextRunAt: Math.ceil(Date.now() + state.activeRun.restMinutes * 60_000),
      minutesUsedToday: usedMinutes,
      activityUsed,
      runsToday: state.runsToday + (minutes > 0 ? 1 : 0),
      recentRunIds: [...(state.recentRunIds ?? []), args.runId].slice(-20),
      lastRunAt: Date.now(), updatedAt: Date.now(),
    })
  },
})

/** Claim a topic follow before clicking; retries or uncertain clicks cannot exceed the daily ramp. */
export const beginFollowInternal = internalMutation({
  args: { profileId: v.id('profiles'), runId: v.string(), date: v.string(), username: v.string() },
  handler: async (ctx, args) => {
    const state = await ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', args.profileId)).unique()
    const username = args.username.toLowerCase()
    if (!/^[\w.]{1,30}$/.test(username) || !state || state.date !== args.date || args.date !== todayDate() ||
      state.day < 3 || state.day > 7 || state.followBlockedDate === args.date || state.activeRun?.id !== args.runId ||
      (state.followAttempts ?? []).some(attempt => attempt.username === username)) return false
    const profile = await ctx.db.get(args.profileId)
    const automationId = ctx.db.normalizeId('automations', state.lastAutomationId ?? '')
    const automation = automationId ? await ctx.db.get(automationId) : null
    const progress = await ctx.db.query('accountProgress').withIndex('by_profile', q => q.eq('profileId', args.profileId)).unique()
    if (!profile?.igLoggedIn || profile.paused || profile.status === 'deleting' || profile.renameFrom || progress?.paused || progress?.issue ||
      !automation?.isActive || !routineLists(automation).some(id => profile.listIds?.some(listId => listId === id))) return false
    const used = { ...emptyWarmupActivity(), ...state.activityUsed }
    if (used.follows >= (state.activityPlan?.follows ?? 0)) return false
    await ctx.db.patch(state._id, { activityUsed: { ...used, follows: used.follows + 1 },
      followAttempts: [...(state.followAttempts ?? []), { username, runId: args.runId, confirmed: false }] })
    return true
  },
})

/** Stop new follows for the UTC day while leaving ordinary browsing and likes available. */
export const pauseFollowsInternal = internalMutation({
  args: { profileId: v.id('profiles'), date: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const state = await ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', args.profileId)).unique()
    if (state && state.date === args.date && args.date === todayDate())
      await ctx.db.patch(state._id, { followBlockedDate: args.date, followBlockReason: args.reason.slice(0, 300) })
  },
})

export const confirmFollowInternal = internalMutation({
  args: { profileId: v.id('profiles'), runId: v.string(), date: v.string(), username: v.string() },
  handler: async (ctx, args) => {
    const state = await ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', args.profileId)).unique()
    if (!state || state.date !== args.date) return
    const attempt = state.followAttempts?.find(item => item.username === args.username.toLowerCase() && item.runId === args.runId)
    if (!attempt || attempt.confirmed) return
    await ctx.db.patch(state._id, { followAttempts: state.followAttempts!.map(item => item === attempt ? { ...item, confirmed: true } : item) })
    await recordActivity(ctx, args.date, { follows: 1 })
  },
})
