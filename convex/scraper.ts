import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { normalizeUsername } from './instagramUsername';
import { addMembership, leadAvailable, setLeadAvailability } from './leadMemberships';
import { jobKey, lookbackMs } from './scraperKeys';

const day = () => new Date().toISOString().slice(0, 10);
const limitFor = (profile: Doc<'profiles'>) => profile.scraperDailyLimit ?? 1000;
const usedToday = (profile: Doc<'profiles'>) => profile.scraperUsageDate === day() ? (profile.scraperUsageCount ?? 0) : 0;

export const jobs = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query('scrapeJobs').order('desc').take(100)),
});

export const accounts = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query('profiles').collect()).map(p => ({
    id: p._id, name: p.name, ready: !!p.sessionId,
    dailyLimit: limitFor(p), used: usedToday(p), cooldownUntil: p.scraperCooldownUntil,
  })),
});

export const cooldownAccount = internalMutation({
  args: { profileId: v.id('profiles'), retryAfterMs: v.optional(v.number()) },
  handler: async (ctx, { profileId, retryAfterMs }) => {
    const profile = await ctx.db.get(profileId);
    if (!profile) return;
    const attempts = Math.max(0, Math.min(profile.scraperRateLimitCount ?? 0, 3));
    const backoffMs = 30 * 60_000 * 2 ** attempts;
    const serverWaitMs = retryAfterMs && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0;
    await ctx.db.patch(profileId, {
      scraperRateLimitCount: attempts + 1,
      scraperCooldownUntil: Date.now() + Math.min(24 * 60 * 60_000, Math.max(backoffMs, serverWaitMs)),
    });
  },
});

export const setDailyLimit = mutation({
  args: { profileId: v.id('profiles'), limit: v.number() },
  handler: async (ctx, { profileId, limit }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw new Error('Limit must be from 1 to 100000');
    if (!await ctx.db.get(profileId)) throw new Error('Profile not found');
    await ctx.db.patch(profileId, { scraperDailyLimit: limit });
  },
});

export const createJobs = mutation({
  args: { links: v.array(v.string()), listId: v.id('leadLists'), lookbackDays: v.number(), postLimit: v.number() },
  handler: async (ctx, args) => {
    if (!await ctx.db.get(args.listId)) throw new Error('Lead list not found');
    if (args.links.length < 1 || args.links.length > 50) throw new Error('Add 1 to 50 profiles');
    if (!Number.isSafeInteger(args.lookbackDays) || args.lookbackDays < 1 || args.lookbackDays > 3650)
      throw new Error('Days must be from 1 to 3650');
    if (!Number.isSafeInteger(args.postLimit) || args.postLimit < 1 || args.postLimit > 5000)
      throw new Error('Post limit must be from 1 to 5000');
    const names = new Set<string>();
    for (const link of args.links) {
      const name = normalizeUsername(link);
      if (!name) throw new Error(`Invalid Instagram profile: ${link.slice(0, 80)}`);
      names.add(name);
    }
    const now = Date.now();
    const windowMs = args.lookbackDays * lookbackMs;
    const sources = [...names].map(username => ({
      username, activeKey: jobKey(username, args.listId, args.lookbackDays, args.postLimit),
    }));
    const existing = await Promise.all(sources.map(source => ctx.db.query('scrapeJobs')
      .withIndex('by_active_key', q => q.eq('activeKey', source.activeKey)).first()));
    const fresh = sources.filter((_, i) => !existing[i]);
    await Promise.all(fresh.map(source => ctx.db.insert('scrapeJobs', {
      username: source.username, listId: args.listId, sinceDate: now - windowMs,
      postLimit: args.postLimit, activeKey: source.activeKey,
      status: 'queued', discovered: 0, createdAt: now, updatedAt: now,
    })));
    return { created: fresh.length, duplicates: names.size - fresh.length };
  },
});

export const retryJob = mutation({
  args: { jobId: v.id('scrapeJobs') },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !['failed', 'paused'].includes(job.status)) throw new Error('Job cannot be retried');
    const key = jobKey(job.username, job.listId,
      Math.round((job.createdAt - job.sinceDate) / lookbackMs), job.postLimit);
    const active = await ctx.db.query('scrapeJobs').withIndex('by_active_key', q => q.eq('activeKey', key)).first();
    if (active && active._id !== jobId) throw new Error('This source is already queued');
    await ctx.db.patch(jobId, { status: 'queued', activeKey: key, error: undefined,
      runId: undefined, leaseUntil: undefined, updatedAt: Date.now() });
  },
});

/** Claim a single job and a profile with remaining UTC daily capacity. */
export const claimNext = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const queued = await ctx.db.query('scrapeJobs').withIndex('by_status_lease', q => q.eq('status', 'queued')).first();
    const paused = queued ? null : await ctx.db.query('scrapeJobs').withIndex('by_status_lease', q => q.eq('status', 'paused')).first();
    const expired = queued || paused ? null : await ctx.db.query('scrapeJobs')
      .withIndex('by_status_lease', q => q.eq('status', 'running').lt('leaseUntil', now)).first();
    const job = queued ?? paused ?? expired;
    if (!job) return null;
    if (!await ctx.db.get(job.listId)) {
      await ctx.db.patch(job._id, { status: 'failed', activeKey: undefined,
        error: 'Lead list was deleted', updatedAt: now });
      return null;
    }
    const profiles = (await ctx.db.query('profiles').collect())
      .filter(p => p.sessionId && p.status !== 'deleting' && !p.renameFrom &&
        (p.scraperCooldownUntil ?? 0) <= now && usedToday(p) < limitFor(p))
      .sort((a, b) => usedToday(a) - usedToday(b));
    if (!profiles.length) return null;
    const profile = profiles[0]!;
    const runId = `${now}-${Math.random()}`;
    await ctx.db.patch(job._id, {
      status: 'running', profileId: profile._id, runId,
      leaseUntil: now + 10 * 60_000, updatedAt: now, error: undefined,
    });
    return { ...job, status: 'running' as const, profileId: profile._id, runId,
      profileName: profile.name, profileProxy: profile.proxy, profileProxyType: profile.proxyType };
  },
});

export const checkpoint = internalMutation({
  args: {
    jobId: v.id('scrapeJobs'), runId: v.string(),
    posts: v.optional(v.array(v.object({ id: v.string(), code: v.string() }))),
    postIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'running' || job.runId !== args.runId) throw new Error('Job run is no longer active');
    await ctx.db.patch(job._id, {
      ...(args.posts ? { posts: args.posts } : {}),
      ...(args.postIndex !== undefined ? { postIndex: args.postIndex } : {}),
      leaseUntil: Date.now() + 10 * 60_000, updatedAt: Date.now(),
    });
    if (args.postIndex !== undefined && job.profileId) {
      const profile = await ctx.db.get(job.profileId);
      if (profile?.scraperRateLimitCount) await ctx.db.patch(profile._id, {
        scraperRateLimitCount: 0, scraperCooldownUntil: undefined,
      });
    }
  },
});

const liker = v.object({
  igId: v.string(), username: v.string(), fullName: v.optional(v.string()),
  profilePicUrl: v.optional(v.string()),
});

/** Indexed ID dedupe and quota reservation happen in one Convex transaction. */
export const saveBatch = internalMutation({
  args: { jobId: v.id('scrapeJobs'), runId: v.string(), likers: v.array(liker) },
  handler: async (ctx, args) => {
    if (args.likers.length > 25) throw new Error('Batch too large');
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'running' || job.runId !== args.runId || !job.profileId)
      throw new Error('Job run is no longer active');
    if (!await ctx.db.get(job.listId)) throw new Error('Lead list was deleted');
    const profile = await ctx.db.get(job.profileId);
    if (!profile) throw new Error('Scraper profile was deleted');
    const remaining = Math.max(0, limitFor(profile) - usedToday(profile));
    const seen = new Set<string>();
    const incoming = args.likers.flatMap(p => {
      const username = normalizeUsername(p.username);
      if (!/^\d+$/.test(p.igId) || !username || seen.has(p.igId)) return [];
      seen.add(p.igId);
      return [{ ...p, username }];
    }).slice(0, remaining);
    const byId = await Promise.all(incoming.map(p => ctx.db.query('leads')
      .withIndex('by_ig_id', q => q.eq('igId', p.igId)).first()));
    const missingNames = [...new Set(incoming.filter((_, i) => !byId[i]).map(p => p.username))];
    const nameMatches = await Promise.all(missingNames.map(username => ctx.db.query('leads')
      .withIndex('by_username', q => q.eq('username', username)).first()));
    const byName = new Map(missingNames.map((name, i) => [name, nameMatches[i] ?? null] as const));
    const claimedExisting = new Set<Id<'leads'>>();
    const writes = incoming.map((p, i) => {
      const nameMatch = byName.get(p.username);
      const existing = byId[i] ?? (nameMatch && !nameMatch.igId && !claimedExisting.has(nameMatch._id) ? nameMatch : null);
      if (existing) {
        claimedExisting.add(existing._id);
        const fullName = p.fullName || existing.fullName;
        const profilePicUrl = p.profilePicUrl || existing.profilePicUrl;
        const unchanged = existing.igId === p.igId && existing.username === p.username &&
          existing.fullName === fullName && existing.profilePicUrl === profilePicUrl &&
          !!existing.enrichmentStatus;
        return Promise.all([
          unchanged ? Promise.resolve() : ctx.db.patch(existing._id, {
            igId: p.igId, username: p.username, fullName, profilePicUrl,
            enrichmentStatus: existing.enrichmentStatus ?? 'pending',
          }),
          addMembership(ctx, existing._id, job.listId, existing.createdAt, leadAvailable(existing)),
        ]).then(() => false);
      }
      const createdAt = Date.now();
      return ctx.db.insert('leads', {
        igId: p.igId, username: p.username, fullName: p.fullName,
        profilePicUrl: p.profilePicUrl, profilePicDescription: undefined,
        enrichmentStatus: 'pending',
        senderId: undefined, dmSent: false, followed: false, createdAt,
      }).then(async leadId => {
        await addMembership(ctx, leadId, job.listId, createdAt, false);
        return true;
      });
    });
    const added = (await Promise.all(writes)).filter(Boolean).length;
    if (incoming.length) {
      await ctx.db.patch(profile._id, { scraperUsageDate: day(), scraperUsageCount: usedToday(profile) + incoming.length });
    }
    await ctx.db.patch(job._id, {
      ...(added ? { discovered: job.discovered + added } : {}),
      leaseUntil: Date.now() + 10 * 60_000, updatedAt: Date.now(),
    });
    return { added, processed: incoming.length,
      limitExhausted: usedToday(profile) + incoming.length >= limitFor(profile) };
  },
});

export const pendingLeads = internalQuery({
  args: {},
  handler: async (ctx) => {
    const describing = await ctx.db.query('leads').withIndex('by_enrichment', q => q.eq('enrichmentStatus', 'describing')).take(10);
    const pending = await ctx.db.query('leads').withIndex('by_enrichment', q => q.eq('enrichmentStatus', 'pending')).take(10 - describing.length);
    return [...describing, ...pending];
  },
});

export const savePictureDescription = internalMutation({
  args: { leadId: v.id('leads'), description: v.string() },
  handler: async (ctx, { leadId, description }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead || !['pending', 'describing'].includes(lead.enrichmentStatus ?? '')) return;
    await ctx.db.patch(leadId, {
      profilePicDescription: description.slice(0, 500), pictureBatchId: undefined, enrichmentStatus: 'pending',
    });
  },
});

export const enrich = internalMutation({
  args: { leadId: v.id('leads'), profilePicDescription: v.optional(v.string()), classification: v.union(
      v.literal('male'), v.literal('female'), v.literal('business')) },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) return;
    await ctx.db.patch(lead._id, {
      profilePicDescription: args.profilePicDescription ?? lead.profilePicDescription,
      pictureBatchId: undefined, classification: args.classification, enrichmentStatus: 'ready',
    });
    await setLeadAvailability(ctx, lead._id, args.classification === 'male' &&
      !lead.senderId && !lead.dmSent && !lead.followed);
  },
});

export const enrichmentError = internalMutation({
  args: { leadId: v.id('leads') },
  handler: async (ctx, { leadId }) => {
    if (await ctx.db.get(leadId)) {
      await ctx.db.patch(leadId, { pictureBatchId: undefined, enrichmentStatus: 'error' });
      await setLeadAvailability(ctx, leadId, false);
    }
  },
});

export const retryEnrichment = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('leads').withIndex('by_enrichment', q => q.eq('enrichmentStatus', 'error')).take(100);
    await Promise.all(rows.map(row => ctx.db.patch(row._id, { enrichmentStatus: 'pending' })));
    return rows.length;
  },
});

export const finish = internalMutation({
  args: { jobId: v.id('scrapeJobs'), runId: v.string(), status: v.union(
    v.literal('completed'), v.literal('failed'), v.literal('paused')), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.runId !== args.runId) return;
    await ctx.db.patch(job._id, {
      status: args.status, activeKey: args.status === 'paused' ? job.activeKey : undefined,
      error: args.error?.slice(0, 500),
      leaseUntil: undefined, runId: undefined, updatedAt: Date.now(),
    });
  },
});
