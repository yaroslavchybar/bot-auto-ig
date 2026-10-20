import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { eligibility, ensureProgress, canFollow } from './routines'
import {
  dayKey,
  dailyOutreachQuota,
  profileOutreachRoutes,
  randomInRange,
  unfollowRange,
} from './routinePolicy'
import { leadAvailable, SCREENING_FAILURE_LIMIT, setLeadAvailability } from './leadMemberships'
import { LeadStatsChanges } from './leadStats'

/** Fence results to the live lease; only approved categories receive a permanent claim. */
export const finish = internalMutation({
  args: {
    automationId: v.id('automations'),
    profileId: v.id('profiles'),
    leadId: v.id('leads'),
    screeningToken: v.string(),
    date: v.string(),
    category: v.optional(
      v.union(v.literal('male'), v.literal('female'), v.literal('business')),
    ),
    confidence: v.optional(v.number()),
    model: v.optional(v.string()),
    englishTextCheckPassed: v.optional(v.boolean()),
    failureReason: v.optional(v.literal('refused')),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId),
      now = Date.now()
    if (
      !lead ||
      lead.senderId ||
      lead.screeningRefused ||
      lead.screeningToken !== args.screeningToken ||
      lead.screeningProfileId !== args.profileId ||
      lead.screeningAutomationId !== args.automationId ||
      (lead.screeningUntil ?? 0) <= now
    )
      return false
    if (args.failureReason && args.category) throw new Error('A refused screening cannot include a category')
    if (
      args.category &&
      (args.confidence === undefined ||
        !Number.isFinite(args.confidence) ||
        args.confidence < 0 ||
        args.confidence > 1)
    )
      throw new Error('Invalid screening confidence')
    if (args.category && !args.model?.trim()) throw new Error('Missing screening model')
    if (args.category === 'male' && typeof args.englishTextCheckPassed !== 'boolean')
      throw new Error('A male screening must include the English text check')
    const e = await eligibility(ctx, args.automationId, args.profileId)
    const state = e ? await ensureProgress(ctx, args.profileId) : null
    const { used, allowance, followed } = e
      ? dailyOutreachQuota(e.policy, state, args.date, args.profileId)
      : { used: 0, allowance: 0, followed: 0 }
    const classification = args.category
    const membership = lead.screeningListId
      ? await ctx.db
          .query('leadMemberships')
          .withIndex('by_lead_list', (q) =>
            q.eq('leadId', lead._id).eq('listId', lead.screeningListId!),
          )
          .first()
      : null
    const accepted = !!(
      classification &&
      !lead.dmSent &&
      !lead.followed &&
      !lead.dmBlocked &&
      canFollow(e) &&
      args.date === dayKey(now) &&
      used < allowance &&
      (e.policy.allowedCategories ?? ['male']).includes(classification) &&
      (classification !== 'male' || args.englishTextCheckPassed === true) &&
      lead.screeningListId &&
      (await ctx.db.get(lead.screeningListId)) &&
      membership?.available &&
      profileOutreachRoutes(e.policy, args.profileId).some(
        (route) => route.leadListId === lead.screeningListId,
      )
    )
    const failures = (lead.screeningFailures ?? 0) + 1
    const patch = {
      ...(args.category
        ? {
            classification,
            screeningStatus: 'ready' as const,
            screenedAt: now,
            ...(classification === 'male'
              ? { englishTextCheckPassed: args.englishTextCheckPassed }
              : {}),
            screeningFailures: undefined,
            screeningUntil: undefined,
          }
        : {
            // A failed attempt does not replace an earlier successful decision.
            screeningStatus: 'error' as const,
            screeningFailures: failures,
            ...(args.failureReason === 'refused' ? { screeningRefused: true } : {}),
            screeningUntil:
              args.failureReason === 'refused' || failures >= SCREENING_FAILURE_LIMIT
                ? undefined
                : now + 5 * 60_000 * 2 ** (failures - 1),
          }),
      screeningToken: undefined,
      screeningProfileId: undefined,
      screeningAutomationId: undefined,
      screeningListId: undefined,
      ...(accepted
        ? {
            senderId: args.profileId,
            outreachListId: lead.screeningListId,
            outreachAutomationId: args.automationId,
            unfollowDays: randomInRange(unfollowRange(e!.policy)),
          }
        : {}),
    }
    await ctx.db.patch(lead._id, patch)
    const next = { ...lead, ...patch }
    const stats = new LeadStatsChanges()
    stats.add(lead, next)
    await stats.flush(ctx)
    await setLeadAvailability(ctx, lead._id, leadAvailable(next))
    if (accepted)
      await ctx.db.patch(state!._id, {
        outreachQuotaDate: args.date,
        outreachUsedToday: used + 1,
        outreachAllowanceToday: allowance,
        followedToday: followed,
        updatedAt: now,
      })
    return accepted
  },
})
