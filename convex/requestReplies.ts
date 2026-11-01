import { v } from 'convex/values'
import { internalMutation, internalQuery, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { canSendDm, eligibility, ensureProgress } from './routines'
import { dayKey } from './routinePolicy'
import { recordActivity } from './analyticsActivity'
import { setLeadAvailability } from './leadMemberships'

const context = { automationId: v.id('automations'), profileId: v.id('profiles') }
const threadArgs = { ...context, threadId: v.string(), username: v.string() }
const reply = (ctx: QueryCtx, profileId: Id<'profiles'>, threadId: string) => ctx.db.query('requestReplies')
  .withIndex('by_profile_thread', q => q.eq('profileId', profileId).eq('threadId', threadId)).unique()
const senderLead = async (ctx: QueryCtx, profileId: Id<'profiles'>, username: string) =>
  (await ctx.db.query('leads').withIndex('by_username', q => q.eq('username', username)).collect())
    .filter(lead => lead.senderId === profileId)

export const plan = internalQuery({
  args: context,
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId)
    if (!canSendDm(e) || !e.outreach?.message.trim()) return null
    const uncertain = await ctx.db.query('requestReplies').withIndex('by_profile_status', q =>
      q.eq('profileId', args.profileId).eq('status', 'sending')).first()
    const pending = await ctx.db.query('requestReplies').withIndex('by_profile_status', q =>
      q.eq('profileId', args.profileId).eq('status', 'pending').eq('automationId', args.automationId)).take(10)
    return { message: e.outreach.message, uncertain: !!uncertain,
      pending: pending.map(({ threadId, username }) => ({ threadId, username })) }
  },
})

/** Persist acceptance intent first, so losing the browser after Accept cannot lose the reply. */
export const prepare = internalMutation({
  args: threadArgs,
  handler: async (ctx, args) => {
    if (!/^\d{1,40}$/.test(args.threadId) || !/^[\w.]{1,30}$/.test(args.username)) throw new Error('Invalid request identity')
    const e = await eligibility(ctx, args.automationId, args.profileId)
    if (!canSendDm(e) || !e.outreach?.message.trim()) return false
    const previous = await reply(ctx, args.profileId, args.threadId)
    if (previous) return previous.automationId === args.automationId && previous.username === args.username && previous.status === 'pending'
    if ((await senderLead(ctx, args.profileId, args.username)).some(lead => lead.dmSent || lead.dmBlocked || lead.dmStartedAt !== undefined)) return false
    const now = Date.now()
    await ctx.db.insert('requestReplies', { ...args, status: 'pending', createdAt: now, updatedAt: now })
    return true
  },
})

/** A request reply is independent of follows, but shares the lead's one-time Send guard. */
export const begin = internalMutation({
  args: threadArgs,
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId)
    const row = await reply(ctx, args.profileId, args.threadId)
    if (!canSendDm(e) || !e.outreach?.message.trim() || !row || row.status !== 'pending' ||
      row.automationId !== args.automationId || row.username !== args.username) return false
    const leads = await senderLead(ctx, args.profileId, args.username)
    if (leads.some(lead => lead.dmSent || lead.dmBlocked || lead.dmStartedAt !== undefined)) {
      await ctx.db.patch(row._id, { status: 'blocked', updatedAt: Date.now() })
      return false
    }
    const now = Date.now()
    await ctx.db.patch(row._id, { status: 'sending', updatedAt: now })
    for (const lead of leads) await ctx.db.patch(lead._id, { dmStartedAt: now, dmStartedDate: dayKey(now), dmEligible: false })
    return true
  },
})

export const finish = internalMutation({
  args: { ...threadArgs, sent: v.boolean(), blocked: v.boolean() },
  handler: async (ctx, args) => {
    const row = await reply(ctx, args.profileId, args.threadId)
    if (!row || row.automationId !== args.automationId || row.username !== args.username) throw new Error('Request reply owner changed')
    if (row.status !== 'sending') return
    const now = Date.now(), date = dayKey(now)
    const state = await ensureProgress(ctx, args.profileId)
    if (!args.sent && !args.blocked) {
      await ctx.db.patch(state._id, { issue: 'Delivery needs review: Request reply could not be confirmed', updatedAt: now })
      return
    }
    await ctx.db.patch(row._id, { status: args.sent ? 'sent' : 'blocked', updatedAt: now })
    for (const lead of await senderLead(ctx, args.profileId, args.username)) {
      await ctx.db.patch(lead._id, args.sent ? { dmSent: true, dmEligible: false } : { dmBlocked: true, dmEligible: false })
      await setLeadAvailability(ctx, lead._id, false)
    }
    if (args.sent) {
      await recordActivity(ctx, date, { dms: 1 })
      await ctx.db.patch(state._id, { dmCountDate: date, sentToday: (state.dmCountDate === date ? state.sentToday ?? 0 : 0) + 1 })
    }
  },
})
