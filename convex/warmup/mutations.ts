import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { planFromConfig, randomMinutes, todayDate } from './helpers'

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
    if (!(await ctx.db.get(args.profileId))) throw new Error('Profile not found')
    const now = Date.now()
    const date = todayDate(now)
    let state = await ctx.db.query('warmupStates')
      .withIndex('by_profile', q => q.eq('profileId', args.profileId)).unique()
    if (!state || state.date !== date) {
      const plan = planFromConfig({ warmup_min_minutes: args.minMinutes, warmup_max_minutes: args.maxMinutes })
      const daily = {
        profileId: args.profileId,
        day: state ? state.day + (state.runsToday > 0 || state.activeRun ? 1 : 0) : 1,
        date, runsToday: 0, todayMinutes: randomMinutes(plan), minutesUsedToday: 0,
        recentRunIds: [] as string[], updatedAt: now,
      }
      if (state) {
        await ctx.db.patch(state._id, { ...daily, activeRun: undefined })
        state = (await ctx.db.get(state._id))!
      } else {
        state = (await ctx.db.get(await ctx.db.insert('warmupStates', daily)))!
      }
    }
    if (state.recentRunIds?.includes(args.runId)) return { date, minutes: 0 }
    if (state.activeRun) {
      return { date, minutes: state.activeRun.id === args.runId ? state.activeRun.minutes : 0,
        remainingMinutes: Math.max(0, state.todayMinutes - (state.minutesUsedToday ?? 0)) }
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
    return { date, minutes, remainingMinutes: Math.max(0, state.todayMinutes - (state.minutesUsedToday ?? 0)) }
  },
})

/** Finish the reservation once. Late results never consume the next day's budget. */
export const finishRunInternal = internalMutation({
  args: { profileId: v.id('profiles'), runId: v.string(), date: v.string(), minutes: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.minutes) || args.minutes < 0) throw new Error('Invalid elapsed minutes')
    const state = await ctx.db.query('warmupStates')
      .withIndex('by_profile', q => q.eq('profileId', args.profileId)).unique()
    if (!state || state.date !== args.date || state.recentRunIds?.includes(args.runId)) return
    if (state.activeRun?.id !== args.runId) throw new Error('Warm-up reservation not found')
    const minutes = Math.min(args.minutes, state.activeRun.minutes)
    await ctx.db.patch(state._id, {
      activeRun: undefined,
      nextRunAt: Date.now() + state.activeRun.restMinutes * 60_000,
      minutesUsedToday: Math.min(state.todayMinutes, (state.minutesUsedToday ?? 0) + minutes),
      runsToday: state.runsToday + (minutes > 0 ? 1 : 0),
      recentRunIds: [...(state.recentRunIds ?? []), args.runId].slice(-20),
      lastRunAt: Date.now(), updatedAt: Date.now(),
    })
  },
})
