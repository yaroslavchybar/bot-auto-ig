import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { internalMutation, mutation, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { normalizeUsername } from './instagramUsername'
import { capacityAt, DAY, day, limitFor, scraperProfiles, usedToday } from './scraperPolicy'
import { HOUR, MONITOR_WINDOW, monitorTraffic } from './scrapeMonitoring'

const LEASE = 10 * 60_000
export const lookbackDays = (list: Doc<'leadLists'>) => list.scrapeLookbackDays ?? 90

export const sources = query({
  args: { listId: v.id('leadLists') },
  handler: async (ctx, { listId }) =>
    (
      await ctx.db
        .query('scrapeSources')
        .withIndex('by_list_username', (q) => q.eq('listId', listId))
        .take(100)
    )
      .filter((s) => !s.deleting)
      .map((s) => ({
        _id: s._id,
        username: s.username,
        enabled: s.enabled,
        running: s.running,
        nextCheckAt: s.nextCheckAt,
        lastCheckAt: s.lastCheckAt,
        averageLikes: s.averageLikes,
        postCount: s.postCount,
        discovered: s.discovered,
        error: s.error,
      })),
})

/** Overview rows need counts, not live per-source progress or worker state. */
export const summary = query({
  args: { listId: v.id('leadLists') },
  handler: async (ctx, { listId }) => {
    const rows = (
      await ctx.db
        .query('scrapeSources')
        .withIndex('by_list_username', (q) => q.eq('listId', listId))
        .take(100)
    ).filter((s) => !s.deleting)
    return { sources: rows.length, leads: rows.reduce((sum, source) => sum + source.discovered, 0) }
  },
})

export const posts = query({
  args: { sourceId: v.id('scrapeSources'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { sourceId, paginationOpts }) => {
    const result = await ctx.db
      .query('scrapePosts')
      .withIndex('by_source_date', (q) => q.eq('sourceId', sourceId))
      .order('desc')
      .paginate(paginationOpts)
    return {
      ...result,
      page: result.page.map((post) => {
        const traffic = monitorTraffic(post.checks ?? [], 0.5)
        return {
          _id: post._id,
          code: post.code,
          takenAt: post.takenAt,
          likeCount: post.likeCount,
          monitoring: post.monitoring,
          scheduled: post.scheduled,
          nextCheckAt: post.nextCheckAt,
          lastScrapedAt: post.lastScrapedAt,
          error: post.error,
          monitorStoppedAt: post.monitorStoppedAt,
          averageNewIds: traffic.averageNewIds,
          likesPerHour: traffic.likesPerHour,
          checkCount: post.checks?.length ?? 0,
        }
      }),
    }
  },
})

export const add = mutation({
  args: { listId: v.id('leadLists'), links: v.array(v.string()) },
  handler: async (ctx, { listId, links }) => {
    if (!(await ctx.db.get(listId))) throw new Error('Lead list not found')
    if (!links.length || links.length > 50) throw new Error('Add 1 to 50 profiles at a time')
    const names = new Set<string>()
    for (const link of links) {
      const username = normalizeUsername(link)
      if (!username) throw new Error(`Invalid Instagram profile: ${link.slice(0, 80)}`)
      names.add(username)
    }
    const existing = await ctx.db
      .query('scrapeSources')
      .withIndex('by_list_username', (q) => q.eq('listId', listId))
      .take(101)
    const known = new Set(existing.filter((s) => !s.deleting).map((s) => s.username))
    const fresh = [...names].filter((name) => !known.has(name))
    if (existing.length + fresh.length > 100)
      throw new Error('A list can have up to 100 source profiles')
    const now = Date.now()
    for (const username of fresh)
      await ctx.db.insert('scrapeSources', {
        username,
        listId,
        enabled: true,
        running: false,
        nextCheckAt: now,
        postCount: 0,
        discovered: 0,
        createdAt: now,
      })
    return { created: fresh.length, duplicates: names.size - fresh.length }
  },
})

export const settings = mutation({
  args: { listId: v.id('leadLists'), days: v.number(), monitor: v.boolean() },
  handler: async (ctx, { listId, days, monitor }) => {
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650)
      throw new Error('Days must be from 1 to 3650')
    const list = await ctx.db.get(listId)
    if (!list) throw new Error('Lead list not found')
    if (lookbackDays(list) === days && (list.scrapeMonitor ?? true) === monitor) return
    await ctx.db.patch(listId, { scrapeLookbackDays: days, scrapeMonitor: monitor })
    const sources = await ctx.db
      .query('scrapeSources')
      .withIndex('by_list_username', (q) => q.eq('listId', listId))
      .take(100)
    // Fence in-flight work so changing the range never saves out-of-range leads.
    for (const source of sources)
      await ctx.db.patch(source._id, {
        running: false,
        runId: undefined,
        leaseUntil: undefined,
        kind: undefined,
        currentPostId: undefined,
        nextCheckAt: Date.now(),
        error: undefined,
      })
  },
})

export const setEnabled = mutation({
  args: { sourceId: v.id('scrapeSources'), enabled: v.boolean() },
  handler: async (ctx, { sourceId, enabled }) => {
    const source = await ctx.db.get(sourceId)
    if (!source || source.deleting) throw new Error('Source not found')
    if (source.enabled === enabled) return
    await ctx.db.patch(sourceId, {
      enabled,
      running: false,
      runId: undefined,
      leaseUntil: undefined,
      currentPostId: undefined,
      kind: undefined,
      ...(enabled ? { nextCheckAt: Date.now(), error: undefined } : {}),
    })
    if (!enabled)
      await ctx.scheduler.runAfter(0, internal.scrapeSources.cleanup, { sourceId, remove: false })
  },
})

export const checkNow = mutation({
  args: { sourceId: v.id('scrapeSources') },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId)
    if (!source || !source.enabled || source.deleting || source.running)
      throw new Error('Source is not available')
    await ctx.db.patch(sourceId, { nextCheckAt: Date.now(), error: undefined })
  },
})

export const remove = mutation({
  args: { sourceId: v.id('scrapeSources') },
  handler: async (ctx, { sourceId }) => {
    if (!(await ctx.db.get(sourceId))) return
    await ctx.db.patch(sourceId, {
      enabled: false,
      running: false,
      deleting: true,
      runId: undefined,
      leaseUntil: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.scrapeSources.cleanup, { sourceId, remove: true })
  },
})

/** Bounded cleanup also cancels pending work after a source/list is removed. */
export const cleanup = internalMutation({
  args: { sourceId: v.id('scrapeSources'), remove: v.boolean() },
  handler: async (ctx, { sourceId, remove }) => {
    const source = await ctx.db.get(sourceId)
    if (!source || (!remove && source.enabled)) return
    const rows = remove
      ? await ctx.db
          .query('scrapePosts')
          .withIndex('by_source_date', (q) => q.eq('sourceId', sourceId))
          .take(100)
      : await ctx.db
          .query('scrapePosts')
          .withIndex('by_source_scheduled', (q) => q.eq('sourceId', sourceId).eq('scheduled', true))
          .take(100)
    for (const post of rows) {
      if (remove) await ctx.db.delete(post._id)
      else await ctx.db.patch(post._id, { scheduled: false })
    }
    if (rows.length === 100)
      await ctx.scheduler.runAfter(0, internal.scrapeSources.cleanup, { sourceId, remove })
    else if (remove) await ctx.db.delete(sourceId)
  },
})

export const cleanupList = internalMutation({
  args: { listId: v.id('leadLists') },
  handler: async (ctx, { listId }) => {
    const rows = await ctx.db
      .query('scrapeSources')
      .withIndex('by_list_username', (q) => q.eq('listId', listId))
      .take(100)
    for (const source of rows) {
      await ctx.db.patch(source._id, {
        enabled: false,
        running: false,
        deleting: true,
        runId: undefined,
      })
      await ctx.scheduler.runAfter(0, internal.scrapeSources.cleanup, {
        sourceId: source._id,
        remove: true,
      })
    }
  },
})

export async function nextWork(ctx: Pick<QueryCtx, 'db'>) {
  const [source, running, monitor, pending] = await Promise.all([
    ctx.db
      .query('scrapeSources')
      .withIndex('by_due', (q) => q.eq('enabled', true).eq('running', false))
      .first(),
    ctx.db
      .query('scrapeSources')
      .withIndex('by_lease', (q) => q.eq('running', true))
      .first(),
    ctx.db
      .query('scrapePosts')
      .withIndex('by_due', (q) => q.eq('scheduled', true).eq('monitoring', true))
      .first(),
    ctx.db
      .query('scrapePosts')
      .withIndex('by_due', (q) => q.eq('scheduled', true).eq('monitoring', false))
      .first(),
  ])
  const work = [
    source ? { at: source.nextCheckAt, key: `source:${source._id}:${source.nextCheckAt}` } : null,
    running
      ? { at: (running.leaseUntil ?? 0) + 1, key: `lease:${running._id}:${running.leaseUntil}` }
      : null,
    ...[monitor, pending].map((p) =>
      p ? { at: p.nextCheckAt, key: `post:${p._id}:${p.nextCheckAt}` } : null,
    ),
  ].filter((w): w is { at: number; key: string } => !!w)
  return work.sort((a, b) => a.at - b.at)[0] ?? null
}

export async function activeSource(
  ctx: Pick<QueryCtx, 'db'>,
  sourceId: Id<'scrapeSources'>,
  runId: string,
  kind?: 'posts' | 'likers',
) {
  const source = await ctx.db.get(sourceId)
  if (
    !source ||
    !source.enabled ||
    source.deleting ||
    !source.running ||
    source.runId !== runId ||
    (source.leaseUntil ?? 0) < Date.now() ||
    (kind && source.kind !== kind)
  )
    throw new Error('Source run is no longer active')
  const list = await ctx.db.get(source.listId)
  if (!list) throw new Error('Lead list was deleted')
  if (source.kind === 'likers') {
    const post = source.currentPostId ? await ctx.db.get(source.currentPostId) : null
    if (!post || (!post.monitoring && post.takenAt < Date.now() - lookbackDays(list) * DAY))
      throw new Error('Post is outside the selected range')
  }
  return source
}

/** One fenced source lease serializes discovery and post checks, including crash recovery. */
export const claim = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const profiles = (await scraperProfiles(ctx))
      .filter(
        (p) => p.scraperReady && p.status !== 'deleting' && !p.renameFrom && capacityAt(p) <= now,
      )
      .sort((a, b) => usedToday(a) - usedToday(b))
    if (!profiles.length) return null
    let source = await ctx.db
      .query('scrapeSources')
      .withIndex('by_lease', (q) => q.eq('running', true).lt('leaseUntil', now))
      .first()
    let post = source?.currentPostId ? await ctx.db.get(source.currentPostId) : null
    let kind: 'posts' | 'likers' = source?.kind ?? 'posts'
    if (!source) {
      // Due monitoring must not wait behind a large initial discovery backlog.
      for (const queue of ['monitor', 'source', 'pending'] as const) {
        if (queue === 'source') {
          source = await ctx.db
            .query('scrapeSources')
            .withIndex('by_due', (q) =>
              q.eq('enabled', true).eq('running', false).lte('nextCheckAt', now),
            )
            .first()
          if (source) break
          continue
        }
        const monitoring = queue === 'monitor'
        const due = await ctx.db
          .query('scrapePosts')
          .withIndex('by_due', (q) =>
            q.eq('scheduled', true).eq('monitoring', monitoring).lte('nextCheckAt', now),
          )
          .take(20)
        for (const candidate of due) {
          const owner = await ctx.db.get(candidate.sourceId)
          const list = owner ? await ctx.db.get(owner.listId) : null
          const expired =
            !!candidate.lastScrapedAt &&
            (!candidate.monitorEligible ||
              !!candidate.monitorStoppedAt ||
              list?.scrapeMonitor === false)
          if (
            !owner ||
            !owner.enabled ||
            owner.deleting ||
            !list ||
            (!candidate.monitoring && candidate.takenAt < now - lookbackDays(list) * DAY) ||
            expired
          ) {
            await ctx.db.patch(candidate._id, { scheduled: false })
            continue
          }
          if (owner.running) continue
          source = owner
          post = candidate
          kind = 'likers'
          break
        }
        if (source) break
      }
    }
    if (!source) return null
    const list = await ctx.db.get(source.listId)
    if (!source.enabled || source.deleting || !list) {
      await ctx.db.patch(source._id, {
        enabled: false,
        running: false,
        runId: undefined,
        leaseUntil: undefined,
      })
      await ctx.scheduler.runAfter(0, internal.scrapeSources.cleanup, {
        sourceId: source._id,
        remove: !list || !!source.deleting,
      })
      return null
    }
    if (
      kind === 'likers' &&
      (!post ||
        (!post.monitoring && post.takenAt < now - lookbackDays(list) * DAY) ||
        (post.lastScrapedAt &&
          (!post.monitorEligible || post.monitorStoppedAt || list.scrapeMonitor === false)))
    ) {
      if (post) await ctx.db.patch(post._id, { scheduled: false })
      await ctx.db.patch(source._id, {
        running: false,
        runId: undefined,
        leaseUntil: undefined,
        currentPostId: undefined,
        kind: undefined,
      })
      return null
    }
    const profile = profiles[0]!
    const runId = `${now}-${Math.random()}`
    await ctx.db.patch(source._id, {
      running: true,
      kind,
      profileId: profile._id,
      runId,
      currentPostId: post?._id,
      leaseUntil: now + LEASE,
      error: undefined,
    })
    return {
      _id: source._id,
      listId: source.listId,
      username: source.username,
      kind,
      profileId: profile._id,
      runId,
      sinceDate: Math.max(0, now - lookbackDays(list) * DAY),
      postLimit: 5000,
      post: post ? { id: post.mediaId, code: post.code } : undefined,
    }
  },
})

export const heartbeat = internalMutation({
  args: { sourceId: v.id('scrapeSources'), runId: v.string() },
  handler: async (ctx, { sourceId, runId }) => {
    await activeSource(ctx, sourceId, runId)
    await ctx.db.patch(sourceId, { leaseUntil: Date.now() + LEASE })
  },
})

export const registerPosts = internalMutation({
  args: {
    sourceId: v.id('scrapeSources'),
    runId: v.string(),
    averageLikes: v.optional(v.number()),
    postCount: v.number(),
    postsFromApify: v.boolean(),
    posts: v.array(
      v.object({
        id: v.string(),
        code: v.string(),
        takenAt: v.number(),
        likeCount: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const source = await activeSource(ctx, args.sourceId, args.runId, 'posts')
    const list = (await ctx.db.get(source.listId))!
    if (
      args.posts.length > 25 ||
      !Number.isSafeInteger(args.postCount) ||
      args.postCount < 0 ||
      args.postCount > 5000 ||
      (args.averageLikes !== undefined &&
        (!Number.isFinite(args.averageLikes) || args.averageLikes < 0))
    )
      throw new Error('Invalid post batch')
    const now = Date.now()
    for (const post of args.posts) {
      if (
        !/^\d+$/.test(post.id) ||
        !/^[\w-]+$/.test(post.code) ||
        !Number.isFinite(post.takenAt) ||
        post.takenAt > now ||
        (post.likeCount !== undefined && (!Number.isFinite(post.likeCount) || post.likeCount < 0))
      )
        throw new Error('Invalid Instagram post')
      if (post.takenAt < now - lookbackDays(list) * DAY) continue
      const old = await ctx.db
        .query('scrapePosts')
        .withIndex('by_source_media', (q) => q.eq('sourceId', source._id).eq('mediaId', post.id))
        .first()
      // Daily discovery must not restart a post stopped for low traffic.
      const monitorEligible = old?.monitorEligible || (args.averageLikes ?? 0) > 100
      const eligible = list.scrapeMonitor !== false && monitorEligible && !old?.monitorStoppedAt
      const pending = !old?.lastScrapedAt
      const monitoring = !pending && eligible
      const patch = {
        code: post.code,
        takenAt: post.takenAt,
        likeCount: post.likeCount,
        monitorEligible,
        monitoring,
        scheduled: pending || eligible,
        nextCheckAt: pending
          ? (old?.nextCheckAt ?? now)
          : monitoring && !old?.scheduled
            ? now + monitorTraffic(old?.checks ?? []).delay
            : (old?.nextCheckAt ?? now),
      }
      if (old) {
        if (Object.entries(patch).some(([key, value]) => old[key as keyof typeof old] !== value))
          await ctx.db.patch(old._id, patch)
      } else
        await ctx.db.insert('scrapePosts', { sourceId: source._id, mediaId: post.id, ...patch })
    }
    await ctx.db.patch(source._id, {
      averageLikes: args.averageLikes,
      postCount: args.postCount,
      postsFromApify: args.postsFromApify,
      leaseUntil: now + LEASE,
    })
  },
})

export const finish = internalMutation({
  args: {
    sourceId: v.id('scrapeSources'),
    runId: v.string(),
    status: v.union(v.literal('completed'), v.literal('failed'), v.literal('paused')),
    error: v.optional(v.string()),
    newIds: v.optional(v.number()),
    likeCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId)
    if (
      !source ||
      !source.running ||
      !source.enabled ||
      source.runId !== args.runId ||
      (source.leaseUntil ?? 0) < Date.now()
    )
      return
    const now = Date.now()
    const success = args.status === 'completed'
    const delay = success ? DAY : args.status === 'paused' ? 0 : HOUR
    const patch: Partial<Doc<'scrapeSources'>> = {
      running: false,
      kind: undefined,
      runId: undefined,
      leaseUntil: undefined,
      currentPostId: undefined,
      error: args.error?.slice(0, 500),
    }
    if (source.kind === 'posts') {
      patch.nextCheckAt = now + delay
      if (success) patch.lastCheckAt = now
    } else if (source.currentPostId) {
      const post = await ctx.db.get(source.currentPostId)
      const list = await ctx.db.get(source.listId)
      if (post) {
        if (
          success &&
          (args.newIds === undefined ||
            !Number.isSafeInteger(args.newIds) ||
            args.newIds < 0 ||
            args.newIds > 100 ||
            (args.likeCount !== undefined &&
              (!Number.isSafeInteger(args.likeCount) || args.likeCount < 0)))
        )
          throw new Error('Invalid post traffic')
        const checks =
          success && post.lastScrapedAt !== undefined
            ? [
                ...(post.checks ?? []),
                {
                  at: now,
                  elapsedMs: Math.max(1, now - post.lastScrapedAt),
                  newIds: args.newIds!,
                  likesGained:
                    args.likeCount !== undefined && post.observedLikeCount !== undefined
                      ? Math.max(0, args.likeCount - post.observedLikeCount)
                      : undefined,
                },
              ].slice(-MONITOR_WINDOW)
            : (post.checks ?? [])
        const traffic = monitorTraffic(checks)
        const next = now + (success ? traffic.delay : delay)
        const monitoring =
          !!list &&
          list.scrapeMonitor !== false &&
          !!post.monitorEligible &&
          !post.monitorStoppedAt &&
          !traffic.stopped
        await ctx.db.patch(post._id, {
          lastScrapedAt: success ? now : post.lastScrapedAt,
          scheduled: success ? monitoring : true,
          monitoring,
          nextCheckAt: next,
          error: args.error?.slice(0, 500),
          ...(success
            ? {
                checks,
                observedLikeCount: args.likeCount,
                likeCount: args.likeCount ?? post.likeCount,
                monitorStoppedAt: traffic.stopped ? now : post.monitorStoppedAt,
              }
            : {}),
        })
      }
      if (success && source.profileId) {
        const profile = await ctx.db.get(source.profileId)
        if (profile) {
          const limit = limitFor(profile)
          const charge = source.postsFromApify === false ? 1 : 0
          await ctx.db.patch(profile._id, {
            scraperUsageDate: day(),
            scraperUsageCount:
              usedToday(profile) +
              (limit === undefined
                ? charge
                : Math.min(charge, Math.max(0, limit - usedToday(profile)))),
            ...((profile.scraperCooldownUntil ?? 0) <= now
              ? { scraperRateLimitCount: 0, scraperCooldownUntil: undefined }
              : {}),
          })
        }
      }
    }
    await ctx.db.patch(source._id, patch)
  },
})
