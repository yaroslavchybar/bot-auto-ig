import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { normalizeUsername } from './instagramUsername'
import { addMembership, leadAvailable, setLeadAvailability } from './leadMemberships'
import { requireServerBridgeAuth } from './serverBridgeAuth'

import { capacityAt, scraperBusy, scraperProfiles } from './scraperPolicy'
import { scraperRequestState } from './scraperRequests'
import { activeSource, nextWork } from './scrapeSources'
import { patchProfile } from './workerMetadata'
import { LeadStatsChanges } from './leadStats'

/** Persisted due times wake Rust timers; this subscription never reads a clock. */
export const work = query({
  args: { bridgeToken: v.string() },
  handler: async (ctx, { bridgeToken }) => {
    requireServerBridgeAuth(bridgeToken)
    const profiles = await scraperProfiles(ctx)
    const blockedProfileIds = profiles
      .filter((p) => scraperBusy(p) || p.paused || !p.scraperReady)
      .map((p) => p._id)
    const available = profiles.filter(
      (p) => p.scraperReady && !scraperBusy(p) && p.status !== 'deleting' && !p.renameFrom,
    )
    const states = await Promise.all(available.map((p) => scraperRequestState(ctx, p._id)))
    const times = available.flatMap((p, i) =>
      states[i]!.availableAt === null ? [] : [Math.max(capacityAt(p), states[i]!.availableAt!)],
    )
    const next = await nextWork(ctx, times.length ? Math.min(...times) : null)
    const taskAt = next?.at ?? null
    return {
      taskAt,
      blockedProfileIds,
      taskKey: next?.key ?? null,
    }
  },
})

export const accounts = query({
  args: {},
  handler: async (ctx) =>
    Promise.all(
      (await scraperProfiles(ctx)).map(async (p) => ({
        id: p._id,
        name: p.name,
        ready: p.scraperReady,
        ...(await scraperRequestState(ctx, p._id)),
        usage: undefined,
        cooldownUntil: p.scraperCooldownUntil,
      })),
    ),
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
    await patchProfile(ctx, profileId, {
      scraperRateLimitCount: attempts + 1,
      scraperCooldownUntil: Math.ceil(
        Date.now() + Math.min(24 * 60 * 60_000, Math.max(backoffMs, serverWaitMs)),
      ),
    })
  },
})

const liker = v.object({
  igId: v.string(),
  username: v.string(),
  fullName: v.optional(v.string()),
  isPrivate: v.optional(v.boolean()),
})

/** Saving leads is independent of request quotas; each HTTP dispatch is charged separately. */
export const saveBatch = internalMutation({
  args: { sourceId: v.id('scrapeSources'), runId: v.string(), likers: v.array(liker) },
  handler: async (ctx, args) => {
    if (args.likers.length > 25) throw new Error('Batch too large')
    const source = await activeSource(ctx, args.sourceId, args.runId, 'likers')
    if (!source.profileId) throw new Error('Scraper profile was deleted')
    const profile = await ctx.db.get(source.profileId)
    if (!profile) throw new Error('Scraper profile was deleted')
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
    const stats = new LeadStatsChanges()
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
      if (existing) {
        claimedExisting.add(existing._id)
        const fullName = p.fullName || existing.fullName
        const isPrivate = p.isPrivate ?? existing.isPrivate
        if (
          existing.igId !== p.igId ||
          existing.username !== p.username ||
          existing.fullName !== fullName ||
          existing.isPrivate !== isPrivate ||
          !existing.enrichmentStatus
        ) {
          await ctx.db.patch(existing._id, {
            igId: p.igId,
            username: p.username,
            fullName,
            isPrivate,
            enrichmentStatus: existing.enrichmentStatus ?? 'pending',
          })
          stats.add(existing, {
            ...existing,
            enrichmentStatus: existing.enrichmentStatus ?? 'pending',
          })
        }
        await addMembership(
          ctx,
          existing._id,
          source.listId,
          existing.createdAt,
          leadAvailable(existing),
          existing.classification,
        )
      } else {
        const createdAt = Date.now()
        const lead = {
          igId: p.igId,
          username: p.username,
          fullName: p.fullName,
          isPrivate: p.isPrivate,
          enrichmentStatus: 'pending' as const,
          dmSent: false,
          followed: false,
          createdAt,
        }
        const leadId = await ctx.db.insert('leads', lead)
        stats.add(null, lead)
        await addMembership(ctx, leadId, source.listId, createdAt, true)
      }
      if (!membership) added++
      processed++
    }
    await stats.flush(ctx)
    await ctx.db.patch(source._id, {
      ...(added ? { discovered: source.discovered + added } : {}),
      leaseUntil: Date.now() + 10 * 60_000,
    })
    return {
      added,
      processed,
      limitExhausted: false,
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
    const stats = new LeadStatsChanges()
    const patch = {
      enrichmentStatus: 'pending' as const,
      screeningFailures: undefined,
      screeningUntil: undefined,
    }
    for (const row of rows) stats.add(row, { ...row, ...patch })
    await Promise.all(rows.map((row) => ctx.db.patch(row._id, patch)))
    await Promise.all(
      rows.map((row) => setLeadAvailability(ctx, row._id, leadAvailable({ ...row, ...patch }))),
    )
    await stats.flush(ctx)
    return rows.length
  },
})
