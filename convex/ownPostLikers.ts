import { v } from 'convex/values'
import { internalMutation, internalQuery, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { dayKey, profileOutreachRoutes } from './routinePolicy'
import { eligibility, ensureProgress, pendingDm, canSendDm } from './routines'
import { reserveRequest } from './scraperRequests'

const args = { automationId: v.id('automations'), profileId: v.id('profiles') }

async function owner(ctx: QueryCtx, automationId: Id<'automations'>, profileId: Id<'profiles'>) {
  const e = await eligibility(ctx, automationId, profileId)
  if (
    !canSendDm(e) ||
    !e.profile.inUse ||
    !e.warmup?.activeRun ||
    (e.profile.scraperCooldownUntil ?? 0) > Date.now()
  )
    return null
  let ownerIgId: string | undefined
  try {
    const cookies: unknown = JSON.parse(e.profile.cookiesJson ?? '[]')
    if (Array.isArray(cookies))
      ownerIgId = cookies.find((cookie) => cookie?.name === 'ds_user_id')?.value
  } catch {
    /* A missing owner ID must not select another scraper account. */
  }
  return typeof ownerIgId === 'string' && /^\d+$/.test(ownerIgId) ? { ...e, ownerIgId } : null
}

export const plan = internalQuery({
  args,
  handler: async (ctx, { automationId, profileId }) => {
    const e = await owner(ctx, automationId, profileId),
      date = dayKey()
    if (!e || e.state?.lastLikerScanDate === date) return null
    const snapshots = await ctx.db
      .query('ownPostLikerSnapshots')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .collect()
    return {
      date,
      ownerIgId: e.ownerIgId,
      runId: e.warmup!.activeRun!.id,
      checkedMediaIds: snapshots
        .filter((row) => row.ownerIgId === e.ownerIgId && row.date === date)
        .map((row) => row.mediaId),
    }
  },
})

export const reserve = internalMutation({
  args: { ...args, runId: v.string(), requestId: v.string() },
  handler: async (ctx, { automationId, profileId, runId, requestId }) => {
    const e = await owner(ctx, automationId, profileId)
    if (!e || e.warmup!.activeRun!.id !== runId)
      return { allowed: false, reason: 'Owning browser session is unavailable' }
    return reserveRequest(ctx, { profileId, requestId }, true)
  },
})

/** The first successful snapshot is a baseline. Missing IDs never clear a DM or follow history. */
export const snapshot = internalMutation({
  args: {
    ...args,
    runId: v.string(),
    ownerIgId: v.string(),
    mediaId: v.string(),
    date: v.string(),
    likers: v.array(v.object({ igId: v.string(), username: v.string() })),
  },
  handler: async (ctx, input) => {
    const { automationId, profileId, ownerIgId, mediaId, date, likers } = input
    const e = await owner(ctx, automationId, profileId)
    if (
      !e ||
      e.ownerIgId !== ownerIgId ||
      e.warmup!.activeRun!.id !== input.runId ||
      date !== dayKey()
    )
      return { saved: false, queued: 0 }
    if (
      !/^\d+$/.test(mediaId) ||
      likers.length > 100 ||
      likers.some((row) => !/^\d+$/.test(row.igId) || !/^[\w.]{1,30}$/.test(row.username))
    )
      throw new Error('Invalid own-post liker snapshot')
    const previous = await ctx.db
      .query('ownPostLikerSnapshots')
      .withIndex('by_profile_media', (q) => q.eq('profileId', profileId).eq('mediaId', mediaId))
      .unique()
    if (previous?.ownerIgId === ownerIgId && previous.date === date)
      return { saved: true, queued: 0 }
    let queued = 0
    const ids = [...new Set(likers.map((row) => row.igId))]
    if (previous?.ownerIgId === ownerIgId) {
      const seen = new Set(previous.ids),
        routes = profileOutreachRoutes(e.policy, profileId),
        now = Date.now()
      for (const liker of likers) {
        if (seen.has(liker.igId)) continue
        seen.add(liker.igId)
        const byId = await ctx.db
          .query('leads')
          .withIndex('by_ig_id', (q) => q.eq('igId', liker.igId))
          .collect()
        const candidates = byId.length
          ? byId
          : await ctx.db
              .query('leads')
              .withIndex('by_username', (q) => q.eq('username', liker.username.toLowerCase()))
              .collect()
        for (const lead of candidates) {
          if (
            (lead.igId && lead.igId !== liker.igId) ||
            !pendingDm(lead, profileId, now) ||
            lead.outreachAutomationId !== automationId ||
            !lead.classification ||
            !(e.policy.allowedCategories ?? ['male']).includes(lead.classification) ||
            !routes.some((route) => route.leadListId === lead.outreachListId) ||
            !lead.outreachListId ||
            !(await ctx.db.get(lead.outreachListId))
          )
            continue
          await ctx.db.patch(lead._id, {
            dmEligible: true,
            postEngagement: { kind: 'like', at: now },
          })
          if (!lead.dmEligible) queued++
        }
      }
    }
    const row = { profileId, ownerIgId, mediaId, ids, date, updatedAt: Date.now() }
    if (previous) await ctx.db.replace(previous._id, row)
    else await ctx.db.insert('ownPostLikerSnapshots', row)
    return { saved: true, queued }
  },
})

export const finish = internalMutation({
  args: { ...args, runId: v.string(), date: v.string() },
  handler: async (ctx, { automationId, profileId, runId, date }) => {
    const e = await owner(ctx, automationId, profileId)
    if (!e || e.warmup!.activeRun!.id !== runId || date !== dayKey()) return false
    const state = await ensureProgress(ctx, profileId)
    await ctx.db.patch(state._id, { lastLikerScanDate: date })
    return true
  },
})
