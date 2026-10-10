import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { normalizeUsername } from './instagramUsername'
import { addMembership, leadAvailable, setLeadAvailability } from './leadMemberships'
import { requireServerBridgeAuth } from './serverBridgeAuth'

import { capacityAt, day, limitFor, scraperProfiles, usedToday } from './scraperPolicy'
import { activeSource, nextWork } from './scrapeSources'

/** Persisted due times wake Rust timers; this subscription never reads a clock. */
export const work = query({
  args: { bridgeToken: v.string() },
  handler: async (ctx, { bridgeToken }) => {
    requireServerBridgeAuth(bridgeToken)
    const [next, describing, pending] = await Promise.all([
      nextWork(ctx),
      ctx.db
        .query('leads')
        .withIndex('by_enrichment', (q) => q.eq('enrichmentStatus', 'describing'))
        .first(),
      ctx.db
        .query('leads')
        .withIndex('by_enrichment', (q) => q.eq('enrichmentStatus', 'pending'))
        .first(),
    ])
    let taskAt: number | null = null
    if (next) {
      const times = (await scraperProfiles(ctx))
        .filter((p) => p.scraperReady && p.status !== 'deleting' && !p.renameFrom)
        .map(capacityAt)
      if (times.length) taskAt = Math.max(next.at, Math.min(...times))
    }
    return {
      taskAt,
      taskKey: next?.key ?? null,
      enrichmentKey: (describing ?? pending)?._id ?? null,
    }
  },
})

export const accounts = query({
  args: {},
  handler: async (ctx) =>
    (await scraperProfiles(ctx)).map((p) => ({
      id: p._id,
      name: p.name,
      ready: p.scraperReady,
      dailyLimit: limitFor(p),
      used: usedToday(p),
      cooldownUntil: p.scraperCooldownUntil,
    })),
})

export const cooldownAccount = internalMutation({
  args: { profileId: v.id('profiles'), retryAfterMs: v.optional(v.number()) },
  handler: async (ctx, { profileId, retryAfterMs }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile) return
    const attempts = Math.max(0, Math.min(profile.scraperRateLimitCount ?? 0, 3))
    const backoffMs = 30 * 60_000 * 2 ** attempts
    const serverWaitMs =
      retryAfterMs && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0
    await ctx.db.patch(profileId, {
      scraperRateLimitCount: attempts + 1,
      scraperCooldownUntil: Math.ceil(
        Date.now() + Math.min(24 * 60 * 60_000, Math.max(backoffMs, serverWaitMs)),
      ),
    })
  },
})

export const setDailyLimit = mutation({
  args: { profileId: v.id('profiles'), limit: v.optional(v.number()) },
  handler: async (ctx, { profileId, limit }) => {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000))
      throw new Error('Limit must be from 1 to 100000')
    if (!(await ctx.db.get(profileId))) throw new Error('Profile not found')
    await ctx.db.patch(profileId, { scraperDailyLimit: limit ?? null })
  },
})

const liker = v.object({
  igId: v.string(),
  username: v.string(),
  fullName: v.optional(v.string()),
  profilePicUrl: v.optional(v.string()),
})

/** Indexed ID dedupe and quota reservation happen in one Convex transaction. */
export const saveBatch = internalMutation({
  args: { sourceId: v.id('scrapeSources'), runId: v.string(), likers: v.array(liker) },
  handler: async (ctx, args) => {
    if (args.likers.length > 25) throw new Error('Batch too large')
    const source = await activeSource(ctx, args.sourceId, args.runId, 'likers')
    if (!source.profileId) throw new Error('Scraper profile was deleted')
    const profile = await ctx.db.get(source.profileId)
    if (!profile) throw new Error('Scraper profile was deleted')
    const limit = limitFor(profile)
    const remaining =
      limit === undefined ? args.likers.length : Math.max(0, limit - usedToday(profile))
    const seen = new Set<string>()
    const incoming = args.likers.map((p) => {
      const username = normalizeUsername(p.username)
      if (!/^\d+$/.test(p.igId) || !username || seen.has(p.igId))
        throw new Error('Invalid liker batch')
      seen.add(p.igId)
      return { ...p, username }
    })
    const byId = await Promise.all(
      incoming.map((p) =>
        ctx.db
          .query('leads')
          .withIndex('by_ig_id', (q) => q.eq('igId', p.igId))
          .first(),
      ),
    )
    const missingNames = [...new Set(incoming.filter((_, i) => !byId[i]).map((p) => p.username))]
    const nameMatches = await Promise.all(
      missingNames.map((username) =>
        ctx.db
          .query('leads')
          .withIndex('by_username', (q) => q.eq('username', username))
          .first(),
      ),
    )
    const byName = new Map(missingNames.map((name, i) => [name, nameMatches[i] ?? null] as const))
    const claimedExisting = new Set<Id<'leads'>>()
    let added = 0
    let processed = 0
    for (const [i, p] of incoming.entries()) {
      const nameMatch = byName.get(p.username)
      const existing =
        byId[i] ??
        (nameMatch && !nameMatch.igId && !claimedExisting.has(nameMatch._id) ? nameMatch : null)
      const membership = existing
        ? await ctx.db
            .query('leadMemberships')
            .withIndex('by_lead_list', (q) =>
              q.eq('leadId', existing._id).eq('listId', source.listId),
            )
            .first()
        : null
      if (!membership && added >= remaining) break
      if (existing) {
        claimedExisting.add(existing._id)
        const fullName = p.fullName || existing.fullName
        const profilePicUrl = p.profilePicUrl || existing.profilePicUrl
        if (
          existing.igId !== p.igId ||
          existing.username !== p.username ||
          existing.fullName !== fullName ||
          existing.profilePicUrl !== profilePicUrl ||
          !existing.enrichmentStatus
        )
          await ctx.db.patch(existing._id, {
            igId: p.igId,
            username: p.username,
            fullName,
            profilePicUrl,
            enrichmentStatus: existing.enrichmentStatus ?? 'pending',
          })
        await addMembership(
          ctx,
          existing._id,
          source.listId,
          existing.createdAt,
          leadAvailable(existing),
        )
      } else {
        const createdAt = Date.now()
        const leadId = await ctx.db.insert('leads', {
          igId: p.igId,
          username: p.username,
          fullName: p.fullName,
          profilePicUrl: p.profilePicUrl,
          enrichmentStatus: 'pending',
          dmSent: false,
          followed: false,
          createdAt,
        })
        await addMembership(ctx, leadId, source.listId, createdAt, false)
      }
      if (!membership) added++
      processed++
    }
    // Retried/repeated accounts already in this list never consume quota twice.
    if (added)
      await ctx.db.patch(profile._id, {
        scraperUsageDate: day(),
        scraperUsageCount: usedToday(profile) + added,
      })
    await ctx.db.patch(source._id, {
      ...(added ? { discovered: source.discovered + added } : {}),
      leaseUntil: Date.now() + 10 * 60_000,
    })
    return {
      added,
      processed,
      limitExhausted: limit !== undefined && usedToday(profile) + added >= limit,
    }
  },
})

export const pendingLeads = internalQuery({
  args: {},
  handler: async (ctx) => {
    const describing = await ctx.db
      .query('leads')
      .withIndex('by_enrichment', (q) => q.eq('enrichmentStatus', 'describing'))
      .take(10)
    const pending = await ctx.db
      .query('leads')
      .withIndex('by_enrichment', (q) => q.eq('enrichmentStatus', 'pending'))
      .take(10 - describing.length)
    return [...describing, ...pending]
  },
})

export const savePictureDescription = internalMutation({
  args: { leadId: v.id('leads'), description: v.string() },
  handler: async (ctx, { leadId, description }) => {
    const lead = await ctx.db.get(leadId)
    if (!lead || !['pending', 'describing'].includes(lead.enrichmentStatus ?? '')) return
    await ctx.db.patch(leadId, {
      profilePicDescription: description.slice(0, 500),
      pictureBatchId: undefined,
      enrichmentStatus: 'pending',
    })
  },
})

export const enrich = internalMutation({
  args: {
    leadId: v.id('leads'),
    profilePicDescription: v.optional(v.string()),
    classification: v.union(v.literal('male'), v.literal('female'), v.literal('business')),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId)
    if (!lead) return
    await ctx.db.patch(lead._id, {
      profilePicDescription: args.profilePicDescription ?? lead.profilePicDescription,
      pictureBatchId: undefined,
      classification: args.classification,
      enrichmentStatus: 'ready',
    })
    await setLeadAvailability(
      ctx,
      lead._id,
      args.classification === 'male' && !lead.senderId && !lead.dmSent && !lead.followed,
    )
  },
})

export const enrichmentError = internalMutation({
  args: { leadId: v.id('leads') },
  handler: async (ctx, { leadId }) => {
    if (await ctx.db.get(leadId)) {
      await ctx.db.patch(leadId, { pictureBatchId: undefined, enrichmentStatus: 'error' })
      await setLeadAvailability(ctx, leadId, false)
    }
  },
})

export const retryEnrichment = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('leads')
      .withIndex('by_enrichment', (q) => q.eq('enrichmentStatus', 'error'))
      .take(100)
    await Promise.all(rows.map((row) => ctx.db.patch(row._id, { enrichmentStatus: 'pending' })))
    return rows.length
  },
})
