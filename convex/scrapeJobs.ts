import { DomainError } from './errors';
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
// NOTE: browser-called queries/mutations below are intentionally public.
// Admin-only access is enforced by the Express session login; the browser
// Convex client carries no identity since Clerk was removed.
import { mutation, query } from './_generated/server';
import { normalizeListIds } from './workflows/helpers';

export const statusValidator = v.union(
  v.literal('idle'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
);

export const configValidator = v.object({
  maxToScrape: v.number(),
  maxAttempts: v.number(),
  retryBackoffSeconds: v.string(),
  openDelaySeconds: v.number(),
  fields: v.object({
    fullName: v.boolean(),
    isVerified: v.boolean(),
    isPrivate: v.boolean(),
  }),
  skip: v.object({
    private: v.boolean(),
    verified: v.boolean(),
    noFullName: v.boolean(),
  }),
});

function cleanString(value: unknown): string {
  return String(value ?? '').trim();
}

// One post per line (full URL, shortcode, or numeric media id).
// Split on whitespace only: post URLs contain commas in theory never,
// but query strings contain & and = which must survive intact.
export function normalizeTargets(value: unknown): string[] {
  const lines = Array.isArray(value) ? value : String(value ?? '').split(/\s+/);
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const raw of lines) {
    const cleaned = String(raw ?? '').trim().replace(/,+$/, '');
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    targets.push(cleaned);
  }
  return targets;
}

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Mirror of server/automation/igWebApi.ts parsePostInput (kept in sync
// manually; both accept a URL, shortcode, or numeric media id).
export function parsePostInput(value: unknown): { mediaPk: string } | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return { mediaPk: raw };
  const urlMatch = raw.match(
    /instagram\.com\/(?:[a-zA-Z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9-_]+)/,
  );
  const code = urlMatch ? urlMatch[2] : raw;
  if (!/^[A-Za-z0-9-_]{6,}$/.test(code)) return null;
  const short = code.slice(0, 11);
  // Media pks exceed float precision, so decoding uses BigInt.
  const base = BigInt(SHORTCODE_ALPHABET.length);
  let num = 0n;
  for (const char of short) {
    const index = SHORTCODE_ALPHABET.indexOf(char);
    if (index < 0) return null;
    num = num * base + BigInt(index);
  }
  if (num <= 0n) return null;
  return { mediaPk: String(num) };
}

function cleanCount(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function normalizeFields(raw: any, base?: { fullName: boolean; isVerified: boolean; isPrivate: boolean }) {
  const fields = raw?.fields ?? {};
  const defaults = { fullName: true, isVerified: true, isPrivate: true };
  const fallback = base ?? defaults;
  return {
    fullName: typeof fields.fullName === 'boolean' ? fields.fullName : (base ? fallback.fullName : defaults.fullName),
    isVerified: typeof fields.isVerified === 'boolean' ? fields.isVerified : (base ? fallback.isVerified : defaults.isVerified),
    isPrivate: typeof fields.isPrivate === 'boolean' ? fields.isPrivate : (base ? fallback.isPrivate : defaults.isPrivate),
  };
}

function normalizeSkip(raw: any, base?: { private: boolean; verified: boolean; noFullName: boolean }) {
  const skip = raw?.skip ?? {};
  const defaults = { private: false, verified: false, noFullName: false };
  const fallback = base ?? defaults;
  return {
    private: typeof skip.private === 'boolean' ? skip.private : (base ? fallback.private : defaults.private),
    verified: typeof skip.verified === 'boolean' ? skip.verified : (base ? fallback.verified : defaults.verified),
    noFullName: typeof skip.noFullName === 'boolean' ? skip.noFullName : (base ? fallback.noFullName : defaults.noFullName),
  };
}

function normalizeConfig(raw: any) {
  return {
    maxToScrape: cleanCount(raw?.maxToScrape, 0),
    maxAttempts: Math.min(20, Math.max(1, cleanCount(raw?.maxAttempts, 4))),
    retryBackoffSeconds: cleanString(raw?.retryBackoffSeconds) || '30,120,600,1800',
    openDelaySeconds: Math.min(60, Math.max(0, cleanCount(raw?.openDelaySeconds, 2))),
    fields: normalizeFields(raw),
    skip: normalizeSkip(raw),
  };
}

function emptyStats() {
  return { scraped: 0, deduped: 0, chunksCompleted: 0, targetsCompleted: 0 };
}

function mergeConfig(existing: any, raw: any) {
  const base = normalizeConfig(existing);
  const next = normalizeConfig({ ...base, ...(raw ?? {}) });
  return {
    ...next,
    fields: normalizeFields(raw, base.fields),
    skip: normalizeSkip(raw, base.skip),
  };
}

async function listJobs(ctx: any) {
  const rows = await ctx.db.query('scrapeJobs').collect();
  rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt);
  return rows;
}

async function getJob(ctx: any, id: any) {
  return (await ctx.db.get(id)) ?? null;
}

async function createJob(ctx: any, args: { name: string; targets?: unknown; listIds?: unknown; config?: unknown }) {
  const name = cleanString(args.name);
  if (!name) throw new DomainError('VALIDATION', 'name is required');
  const targets = normalizeTargets(args.targets);
  if (!targets.length) throw new DomainError('VALIDATION', 'at least one post is required');
  if (targets.some((target) => !parsePostInput(target)))
    throw new DomainError('VALIDATION', 'invalid post link (use a post URL, shortcode, or media id)');
  const now = Date.now();
  const id = await ctx.db.insert('scrapeJobs', {
    name,
    targets,
    listIds: normalizeListIds(args.listIds as any[]) as any,
    status: 'idle',
    config: normalizeConfig(args.config),
    stats: emptyStats(),
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(id);
}

async function updateJob(ctx: any, args: { id: any; name?: unknown; targets?: unknown; listIds?: unknown; config?: unknown }) {
  const existing = await ctx.db.get(args.id);
  if (!existing) throw new DomainError('NOT_FOUND', 'Scrape job not found');
  if (existing.status === 'running')
    throw new DomainError('CONFLICT', 'Cannot update a running job');
  const patch: Record<string, any> = { updatedAt: Date.now() };
  if (args.name !== undefined) {
    const name = cleanString(args.name);
    if (!name) throw new DomainError('VALIDATION', 'name cannot be empty');
    patch.name = name;
  }
  if (args.targets !== undefined) {
    const targets = normalizeTargets(args.targets);
    if (!targets.length) throw new DomainError('VALIDATION', 'at least one post is required');
    if (targets.some((target) => !parsePostInput(target)))
      throw new DomainError('VALIDATION', 'invalid post link (use a post URL, shortcode, or media id)');
    patch.targets = targets;
  }
  if (args.listIds !== undefined) patch.listIds = normalizeListIds(args.listIds as any[]);
  if (args.config !== undefined) patch.config = mergeConfig(existing.config, args.config);
  await ctx.db.patch(args.id, patch);
  return await ctx.db.get(args.id);
}

async function removeJob(ctx: any, id: any) {
  const existing = await ctx.db.get(id);
  if (!existing) throw new DomainError('NOT_FOUND', 'Scrape job not found');
  if (existing.status === 'running')
    throw new DomainError('CONFLICT', 'Cannot delete a running job');
  await ctx.db.delete(id);
  return true;
}

export const list = query({
  args: {},
  handler: async (ctx) => await listJobs(ctx),
});

export const get = query({
  args: { id: v.id('scrapeJobs') },
  handler: async (ctx, args) => await getJob(ctx, args.id),
});

export const listInternal = internalQuery({
  args: {},
  handler: async (ctx) => await listJobs(ctx),
});

export const getInternal = internalQuery({
  args: { id: v.id('scrapeJobs') },
  handler: async (ctx, args) => await getJob(ctx, args.id),
});

export const create = mutation({
  args: {
    name: v.string(),
    targets: v.optional(v.union(v.array(v.string()), v.string())),
    listIds: v.optional(v.array(v.id('lists'))),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args) => await createJob(ctx, args),
});

export const update = mutation({
  args: {
    id: v.id('scrapeJobs'),
    name: v.optional(v.string()),
    targets: v.optional(v.union(v.array(v.string()), v.string())),
    listIds: v.optional(v.array(v.id('lists'))),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args) => await updateJob(ctx, args),
});

export const remove = mutation({
  args: { id: v.id('scrapeJobs') },
  handler: async (ctx, args) => await removeJob(ctx, args.id),
});

export const createInternal = internalMutation({
  args: {
    name: v.string(),
    targets: v.optional(v.union(v.array(v.string()), v.string())),
    listIds: v.optional(v.array(v.id('lists'))),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args) => await createJob(ctx, args),
});

export const updateInternal = internalMutation({
  args: {
    id: v.id('scrapeJobs'),
    name: v.optional(v.string()),
    targets: v.optional(v.union(v.array(v.string()), v.string())),
    listIds: v.optional(v.array(v.id('lists'))),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args) => await updateJob(ctx, args),
});

export const removeInternal = internalMutation({
  args: { id: v.id('scrapeJobs') },
  handler: async (ctx, args) => await removeJob(ctx, args.id),
});

export const startInternal = internalMutation({
  args: { id: v.id('scrapeJobs') },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new DomainError('NOT_FOUND', 'Scrape job not found');
    if (existing.status === 'running')
      throw new DomainError('CONFLICT', 'Scrape job is already running');
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: 'running',
      error: undefined,
      startedAt: now,
      completedAt: undefined,
      updatedAt: now,
    });
    return await ctx.db.get(args.id);
  },
});

export const finishInternal = internalMutation({
  args: {
    id: v.id('scrapeJobs'),
    status: v.union(v.literal('completed'), v.literal('failed'), v.literal('cancelled')),
    error: v.optional(v.string()),
    stats: v.optional(v.object({
      scraped: v.optional(v.number()),
      deduped: v.optional(v.number()),
      chunksCompleted: v.optional(v.number()),
      targetsCompleted: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new DomainError('NOT_FOUND', 'Scrape job not found');
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: args.status,
      error: cleanString(args.error) || undefined,
      stats: {
        scraped: cleanCount(args.stats?.scraped ?? existing.stats.scraped, 0),
        deduped: cleanCount(args.stats?.deduped ?? existing.stats.deduped, 0),
        chunksCompleted: cleanCount(args.stats?.chunksCompleted ?? existing.stats.chunksCompleted, 0),
        targetsCompleted: cleanCount(args.stats?.targetsCompleted ?? existing.stats.targetsCompleted, 0),
      },
      completedAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(args.id);
  },
});

export const updateStatsInternal = internalMutation({
  args: {
    id: v.id('scrapeJobs'),
    stats: v.object({
      scraped: v.optional(v.number()),
      deduped: v.optional(v.number()),
      chunksCompleted: v.optional(v.number()),
      targetsCompleted: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new DomainError('NOT_FOUND', 'Scrape job not found');
    await ctx.db.patch(args.id, {
      stats: {
        scraped: cleanCount(args.stats?.scraped ?? existing.stats.scraped, 0),
        deduped: cleanCount(args.stats?.deduped ?? existing.stats.deduped, 0),
        chunksCompleted: cleanCount(args.stats?.chunksCompleted ?? existing.stats.chunksCompleted, 0),
        targetsCompleted: cleanCount(args.stats?.targetsCompleted ?? existing.stats.targetsCompleted, 0),
      },
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

export const reconcileInterruptedInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db
      .query('scrapeJobs')
      .withIndex('by_status', (q) => q.eq('status', 'running'))
      .collect();
    for (const job of running) {
      await ctx.db.patch(job._id, {
        status: 'failed',
        error: 'Server restarted during execution',
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return { reconciled: running.length };
  },
});
