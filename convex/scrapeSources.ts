import { releasedSourceRun } from './scraperPolicy'
import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { normalizeUsername } from './instagramUsername'
import { capacityAt, DAY, scraperBusy, scraperProfiles } from './scraperPolicy'
import { scraperRequestState, publishSleep } from './scraperRequests'
import {
  DEFAULT_SCRAPE_POST_LIMIT,
  HOUR,
  monitorDelay,
} from './scrapeMonitoring'
import { patchProfile, syncSourceCount } from './workerMetadata'

const LEASE = 10 * 60_000
export const lookbackDays = (list: Doc<'leadLists'>) => list.scrapeLookbackDays ?? 90
const postLimit = (list: Doc<'leadLists'>) => list.scrapePostLimit ?? DEFAULT_SCRAPE_POST_LIMIT
const firstScrape = (post: Doc<'scrapePosts'>) => post.firstScrapedAt ?? post.lastScrapedAt
const withinMonitorRange = (list: Doc<'leadLists'>, firstScrapedAt: number | undefined) =>
  list.scrapeMonitor !== false &&
  (firstScrapedAt === undefined || firstScrapedAt + DAY > Date.now())

/** Backfill the oldest known scrape time once; rediscovery never extends the window. */
async function ensureExpiry(ctx: MutationCtx, post: Doc<'scrapePosts'>) {
  if (post.firstScrapedAt !== undefined || post.lastScrapedAt === undefined) return
  const firstScrapedAt = post.lastScrapedAt
  await ctx.db.patch(post._id, { firstScrapedAt })
  await ctx.scheduler.runAt(
    Math.max(Date.now(), firstScrapedAt + DAY),
    internal.scrapeSources.expirePost,
    { postId: post._id, firstScrapedAt },
  )
  post.firstScrapedAt = firstScrapedAt
}

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
        runKind: s.runKind,
        currentPostId: s.currentPostId,
        nextCheckAt: s.nextCheckAt,
        lastPostsCheckAt: s.lastPostsCheckAt,
        lastLikerCheckAt: s.lastLikerCheckAt,
        averageLikes: s.averageLikes,
        postCount: s.postCount,
        leadsAdded: s.leadsAdded,
        error: s.error,
      })),
})

/** Overview rows need counts, not live per-source progress or worker state. */
export const summary = query({
  args: { listId: v.id('leadLists') },
  handler: async (ctx, { listId }) => {
    const counter = await ctx.db
      .query('leadListCounts')
      .withIndex('by_list', (q) => q.eq('listId', listId))
      .unique()
    if (counter?.sourceCount !== undefined)
      return { sources: counter.sourceCount, leads: counter.count ?? null }
    const rows = (
      await ctx.db
        .query('scrapeSources')
        .withIndex('by_list_username', (q) => q.eq('listId', listId))
        .take(100)
    ).filter((s) => !s.deleting)
    return { sources: rows.length, leads: counter?.count ?? null }
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
          firstScrapedAt: post.firstScrapedAt,
          monitorEndsAt: firstScrape(post) === undefined ? undefined : firstScrape(post)! + DAY,
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
        leadsAdded: 0,
        createdAt: now,
      })
    await syncSourceCount(ctx, listId)
    return { created: fresh.length, duplicates: names.size - fresh.length }
  },
})

export const settings = mutation({
  args: {
    listId: v.id('leadLists'),
    days: v.number(),
    monitor: v.boolean(),
    postLimit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { listId, days, monitor, postLimit: requestedPostLimit },
  ) => {
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650)
      throw new Error('Days must be from 1 to 3650')
    const list = await ctx.db.get(listId)
    if (!list) throw new Error('Lead list not found')
    const latestPosts = requestedPostLimit ?? postLimit(list)
    if (!Number.isSafeInteger(latestPosts) || latestPosts < 1 || latestPosts > 5000)
      throw new Error('Post limit must be from 1 to 5000')
    if (
      lookbackDays(list) === days &&
      (list.scrapeMonitor ?? true) === monitor &&
      postLimit(list) === latestPosts
    )
      return
    await ctx.db.patch(listId, {
      scrapeLookbackDays: days,
      scrapeMonitor: monitor,
      scrapePostLimit: latestPosts,
    })
    const sources = await ctx.db
      .query('scrapeSources')
      .withIndex('by_list_username', (q) => q.eq('listId', listId))
      .take(100)
    // Fence in-flight work so changing the range never saves out-of-range leads.
    for (const source of sources) {
      await ctx.db.patch(source._id, {
        ...releasedSourceRun,
        nextCheckAt: Date.now(),
        error: undefined,
      })
      await ctx.scheduler.runAfter(0, internal.scrapeSources.trimPosts, { sourceId: source._id })
    }
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
      ...releasedSourceRun,
      ...(enabled ? { nextCheckAt: Date.now(), error: undefined } : {}),
    })
    if (!enabled)
      await ctx.scheduler.runAfter(0, internal.scrapeSources.cleanup, { sourceId, remove: false })
    else await ctx.scheduler.runAfter(0, internal.scrapeSources.resumeMonitoring, { sourceId })
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
    const source = await ctx.db.get(sourceId)
    if (!source) return
    await ctx.db.patch(sourceId, {
      enabled: false,
      ...releasedSourceRun,
      deleting: true,
    })
    await syncSourceCount(ctx, source.listId)
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

/** Reconcile monitors with list settings in bounded batches; keep initial scrapes intact. */
export const resumeMonitoring = internalMutation({
  args: { sourceId: v.id('scrapeSources'), cursor: v.optional(v.string()) },
  handler: async (ctx, { sourceId, cursor }) => {
    const source = await ctx.db.get(sourceId)
    if (!source?.enabled || source.deleting) return
    const list = await ctx.db.get(source.listId)
    if (!list) return
    const batch = await ctx.db
      .query('scrapePosts')
      .withIndex('by_source_date', (q) => q.eq('sourceId', sourceId))
      .paginate({ cursor: cursor ?? null, numItems: 100 })
    for (const post of batch.page) {
      if (post.lastScrapedAt === undefined) continue
      await ensureExpiry(ctx, post)
      const monitoring = withinMonitorRange(list, firstScrape(post))
      if (post.monitoring !== monitoring || post.scheduled !== monitoring)
        await ctx.db.patch(post._id, { monitoring, scheduled: monitoring })
    }
    if (!batch.isDone)
      await ctx.scheduler.runAfter(0, internal.scrapeSources.resumeMonitoring, {
        sourceId,
        cursor: batch.continueCursor,
      })
  },
})

/** Keep the newest selected posts and cancel outdated monitors, in bounded batches. */
export const trimPosts = internalMutation({
  args: {
    sourceId: v.id('scrapeSources'),
    cursor: v.optional(v.string()),
    kept: v.optional(v.number()),
    likes: v.optional(v.number()),
    known: v.optional(v.number()),
    settingsKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId)
    if (!source || source.deleting || (source.running && source.runKind === 'posts')) return
    const list = await ctx.db.get(source.listId)
    if (!list) return
    const key = `${lookbackDays(list)}:${postLimit(list)}:${list.scrapeMonitor !== false}:${source.lastPostsCheckAt ?? 0}`
    // A later settings save starts a fresh pass; stale continuations must not delete posts.
    if (args.settingsKey && args.settingsKey !== key) return
    const batch = await ctx.db
      .query('scrapePosts')
      .withIndex('by_source_date', (q) => q.eq('sourceId', source._id))
      .order('desc')
      .paginate({ cursor: args.cursor ?? null, numItems: 100 })
    let kept = args.kept ?? 0
    let likes = args.likes ?? 0
    let known = args.known ?? 0
    let cancelled = false
    for (const post of batch.page) {
      const remove = kept >= postLimit(list)
      if (!remove) await ensureExpiry(ctx, post)
      const monitoring = source.enabled && withinMonitorRange(list, firstScrape(post))
      const reconcile = post.lastScrapedAt !== undefined || post.monitoring
      const cancelMonitor = reconcile && !monitoring
      if (remove) await ctx.db.delete(post._id)
      else {
        kept++
        if (post.likeCount !== undefined) {
          likes += post.likeCount
          known++
        }
        if (reconcile && (post.monitoring !== monitoring || post.scheduled !== monitoring))
          await ctx.db.patch(post._id, {
            monitoring,
            scheduled: monitoring,
            ...(firstScrape(post) !== undefined && firstScrape(post)! + DAY <= Date.now()
              ? { monitorStoppedAt: Date.now() }
              : {}),
          })
      }
      if ((remove || cancelMonitor) && source.running && source.currentPostId === post._id)
        cancelled = true
    }
    if (cancelled)
      await ctx.db.patch(source._id, {
        ...releasedSourceRun,
      })
    if (!batch.isDone)
      await ctx.scheduler.runAfter(0, internal.scrapeSources.trimPosts, {
        sourceId: source._id,
        cursor: batch.continueCursor,
        kept,
        likes,
        known,
        settingsKey: key,
      })
    else
      await ctx.db.patch(source._id, {
        postCount: kept,
        averageLikes: kept > 0 && known === kept ? likes / kept : undefined,
      })
  },
})

export const cleanupList = internalMutation({
  args: { listId: v.id('leadLists'), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { listId, cursor }) => {
    const batch = await ctx.db
      .query('scrapeSources')
      .withIndex('by_list_username', (q) => q.eq('listId', listId))
      .paginate({ cursor: cursor ?? null, numItems: 100 })
    for (const source of batch.page) {
      await ctx.db.patch(source._id, {
        enabled: false,
        ...releasedSourceRun,
        deleting: true,
      })
      await ctx.scheduler.runAfter(0, internal.scrapeSources.cleanup, {
        sourceId: source._id,
        remove: true,
      })
    }
    if (!batch.isDone) await ctx.scheduler.runAfter(0, internal.scrapeSources.cleanupList, {
      listId, cursor: batch.continueCursor,
    })
  },
})

export async function nextWork(ctx: Pick<QueryCtx, 'db'>, likerAt: number | null = 0) {
  const [source, running, monitor, pending] = await Promise.all([
    ctx.db
      .query('scrapeSources')
      .withIndex('by_due', (q) => q.eq('enabled', true).eq('running', false))
      .first(),
    ctx.db
      .query('scrapeSources')
      .withIndex('by_lease', (q) => q.eq('running', true))
      .filter((q) => (likerAt !== null ? true : q.neq(q.field('runKind'), 'likers')))
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
      ? {
          at:
            running.runKind === 'likers'
              ? Math.max((running.leaseUntil ?? 0) + 1, likerAt ?? Infinity)
              : (running.leaseUntil ?? 0) + 1,
          key: `lease:${running._id}:${running.leaseUntil}`,
        }
      : null,
    ...[monitor, pending].map((p) =>
      p && likerAt !== null
        ? { at: Math.max(p.nextCheckAt, likerAt), key: `post:${p._id}:${p.nextCheckAt}` }
        : null,
    ),
  ].filter((w): w is { at: number; key: string } => !!w)
  return work.sort((a, b) => a.at - b.at)[0] ?? null
}

export async function activeSource(
  ctx: Pick<QueryCtx, 'db'>,
  sourceId: Id<'scrapeSources'>,
  runId: string,
  runKind?: 'posts' | 'likers',
) {
  const source = await ctx.db.get(sourceId)
  if (
    !source ||
    !source.enabled ||
    source.deleting ||
    !source.running ||
    source.runId !== runId ||
    (source.leaseUntil ?? 0) < Date.now() ||
    (runKind && source.runKind !== runKind)
  )
    throw new Error('Source run is no longer active')
  const list = await ctx.db.get(source.listId)
  if (!list) throw new Error('Lead list was deleted')
  if (source.runKind === 'likers') {
    const profile = source.profileId ? await ctx.db.get(source.profileId) : null
    if (!profile) throw new Error('Scraper profile was deleted')
    if (profile.paused) throw new Error('Profile is paused')
    if (scraperBusy(profile)) throw new Error('Scraper profile is busy in the browser')
    if (!profile.instagramSessionId) throw new Error('Browser session is missing')
    const post = source.currentPostId ? await ctx.db.get(source.currentPostId) : null
    if (!post || (!post.monitoring && post.takenAt < Date.now() - lookbackDays(list) * DAY))
      throw new Error('Post is outside the selected range')
    if (firstScrape(post) !== undefined && !withinMonitorRange(list, firstScrape(post)))
      throw new Error('Post is outside the monitoring range')
  }
  return source
}

/** One fenced source lease serializes discovery and post checks, including crash recovery. */
export const claim = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const candidates = (await scraperProfiles(ctx)).filter(
      (p) =>
        p.scraperReady &&
        !scraperBusy(p) &&
        p.status !== 'deleting' &&
        !p.pendingRenameFrom &&
        capacityAt(p) <= now,
    )
    const states = await Promise.all(
      candidates.map((profile) => scraperRequestState(ctx, profile._id, now)),
    )
    const profiles = candidates
      .filter(
        (_, index) => states[index]!.availableAt !== null && states[index]!.availableAt! <= now,
      )
      .sort((a, b) => states[candidates.indexOf(a)]!.used - states[candidates.indexOf(b)]!.used)
    if (!profiles.length) {
      for (let i = 0; i < candidates.length; i++)
        await publishSleep(ctx, candidates[i]!._id, states[i]!)
    }
    let source = await ctx.db
      .query('scrapeSources')
      .withIndex('by_lease', (q) => q.eq('running', true).lt('leaseUntil', now))
      .filter((q) => (profiles.length ? true : q.neq(q.field('runKind'), 'likers')))
      .first()
    let post = source?.currentPostId ? await ctx.db.get(source.currentPostId) : null
    let runKind: 'posts' | 'likers' = source?.runKind ?? 'posts'
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
        if (!profiles.length) continue
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
            candidate.lastScrapedAt !== undefined &&
            (list?.scrapeMonitor === false ||
              (!!list && !withinMonitorRange(list, firstScrape(candidate))))
          if (
            !owner ||
            !owner.enabled ||
            owner.deleting ||
            !list ||
            (!candidate.monitoring && candidate.takenAt < now - lookbackDays(list) * DAY) ||
            expired
          ) {
            await ctx.db.patch(candidate._id, {
              scheduled: false,
              ...(expired ? { monitoring: false } : {}),
            })
            continue
          }
          if (owner.running) continue
          source = owner
          post = candidate
          runKind = 'likers'
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
        ...releasedSourceRun,
      })
      await ctx.scheduler.runAfter(0, internal.scrapeSources.cleanup, {
        sourceId: source._id,
        remove: !list || !!source.deleting,
      })
      return null
    }
    if (
      runKind === 'likers' &&
      (!post ||
        (!post.monitoring && post.takenAt < now - lookbackDays(list) * DAY) ||
        (post.lastScrapedAt !== undefined &&
          (list.scrapeMonitor === false || !withinMonitorRange(list, firstScrape(post)))))
    ) {
      if (post) await ctx.db.patch(post._id, { scheduled: false, monitoring: false })
      await ctx.db.patch(source._id, {
        ...releasedSourceRun,
      })
      return null
    }
    const profile = runKind === 'likers' ? profiles[0] : undefined
    if (runKind === 'likers' && !profile) return null
    const runId = `${now}-${Math.random()}`
    await ctx.db.patch(source._id, {
      running: true,
      runKind,
      profileId: profile?._id,
      runId,
      currentPostId: post?._id,
      leaseUntil: now + LEASE,
      error: undefined,
    })
    return {
      _id: source._id,
      listId: source.listId,
      username: source.username,
      runKind,
      profileId: profile?._id ?? '',
      runId,
      sinceDate: Math.max(0, now - lookbackDays(list) * DAY),
      postLimit: postLimit(list),
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
      args.postCount > postLimit(list) ||
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
      if (old) await ensureExpiry(ctx, old)
      // Daily discovery must not extend a post's original monitoring window.
      const eligible =
        list.scrapeMonitor !== false && withinMonitorRange(list, old ? firstScrape(old) : undefined)
      const pending = old?.lastScrapedAt === undefined
      const monitoring = !pending && eligible
      const patch = {
        code: post.code,
        takenAt: post.takenAt,
        likeCount: post.likeCount,
        monitoring,
        scheduled: pending || eligible,
        nextCheckAt: pending
          ? (old?.nextCheckAt ?? now)
          : monitoring && !old?.scheduled
            ? Math.min(now + monitorDelay(), firstScrape(old!)! + DAY)
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
      ...releasedSourceRun,
      error: args.error?.slice(0, 500),
    }
    if (source.runKind === 'posts') {
      patch.nextCheckAt = now + delay
      if (success) patch.lastPostsCheckAt = now
      await ctx.scheduler.runAfter(0, internal.scrapeSources.trimPosts, { sourceId: source._id })
    } else if (source.currentPostId) {
      if (success) patch.lastLikerCheckAt = now
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
        const firstScrapedAt =
          post.firstScrapedAt ?? post.lastScrapedAt ?? (success ? now : undefined)
        const endsAt = firstScrapedAt === undefined ? Infinity : firstScrapedAt + DAY
        const next = Math.min(endsAt, now + (success ? monitorDelay() : delay))
        const monitoring =
          !!list &&
          list.scrapeMonitor !== false &&
          firstScrapedAt !== undefined &&
          withinMonitorRange(list, firstScrapedAt)
        await ctx.db.patch(post._id, {
          firstScrapedAt,
          lastScrapedAt: success ? now : post.lastScrapedAt,
          scheduled: success ? monitoring : firstScrapedAt === undefined || monitoring,
          monitoring,
          nextCheckAt: next,
          error: args.error?.slice(0, 500),
          ...(success
            ? {
                likeCount: args.likeCount ?? post.likeCount,
                monitorStoppedAt: now >= endsAt ? now : undefined,
              }
            : {}),
        })
        if (success && post.firstScrapedAt === undefined) {
          const firstScrapedAt = post.lastScrapedAt ?? now
          await ctx.scheduler.runAt(firstScrapedAt + DAY, internal.scrapeSources.expirePost, {
            postId: post._id,
            firstScrapedAt,
          })
        }
      }
      if (success && source.profileId) {
        const profile = await ctx.db.get(source.profileId)
        if (profile && (profile.scraperCooldownUntil ?? 0) <= now)
          await patchProfile(ctx, profile._id, {
            scraperRateLimitCount: 0,
            scraperCooldownUntil: undefined,
          })
      }
    }
    await ctx.db.patch(source._id, patch)
  },
})

/** Stop at 24 hours even if every session is sleeping or at its request limit. */
export const expirePost = internalMutation({
  args: { postId: v.id('scrapePosts'), firstScrapedAt: v.number() },
  handler: async (ctx, { postId, firstScrapedAt }) => {
    const post = await ctx.db.get(postId)
    if (!post || post.firstScrapedAt !== firstScrapedAt || Date.now() < firstScrapedAt + DAY) return
    await ctx.db.patch(postId, {
      monitoring: false,
      scheduled: false,
      monitorStoppedAt: Date.now(),
    })
    const source = await ctx.db.get(post.sourceId)
    if (source?.currentPostId === postId)
      await ctx.db.patch(source._id, {
        ...releasedSourceRun,
      })
  },
})
