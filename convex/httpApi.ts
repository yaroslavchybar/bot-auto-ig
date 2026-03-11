import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'

function computeProfileMode(proxy: unknown): 'proxy' | 'direct' {
  const value = typeof proxy === 'string' ? proxy.trim() : ''
  return value ? 'proxy' : 'direct'
}

function normalizeDailyScrapingLimit(limit: unknown): number | undefined {
  if (limit === null || typeof limit === 'undefined') return undefined
  const numeric = Number(limit)
  if (!Number.isFinite(numeric)) return undefined
  return Math.max(0, Math.floor(numeric))
}

async function listProfiles(ctx: any) {
  const rows = await ctx.db.query('profiles').collect()
  rows.sort((a: any, b: any) => a.createdAt - b.createdAt)
  return rows
}

async function listWorkflows(ctx: any, status?: string) {
  const rows = status
    ? await ctx.db
        .query('workflows')
        .withIndex('by_status', (q: any) => q.eq('status', status))
        .collect()
    : await ctx.db.query('workflows').collect()

  rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt)
  return rows
}

export const profilesList = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await listProfiles(ctx)
  },
})

export const profilesCreate = internalMutation({
  args: {
    name: v.string(),
    proxy: v.optional(v.string()),
    proxyType: v.optional(v.string()),
    testIp: v.optional(v.boolean()),
    fingerprintSeed: v.optional(v.string()),
    fingerprintOs: v.optional(v.string()),
    cookiesJson: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    dailyScrapingLimit: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const name = String(args.name || '').trim()
    if (!name) throw new Error('name is required')
    const proxy = typeof args.proxy === 'string' ? args.proxy : undefined
    const cookiesJson = typeof args.cookiesJson === 'string' ? args.cookiesJson.trim() : ''
    const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''

    const id = await ctx.db.insert('profiles', {
      createdAt: Date.now(),
      name,
      proxy,
      proxyType: args.proxyType,
      status: 'idle',
      mode: computeProfileMode(proxy),
      sessionId: sessionId || undefined,
      cookiesJson: cookiesJson || undefined,
      using: false,
      testIp: args.testIp ?? false,
      fingerprintSeed: args.fingerprintSeed,
      fingerprintOs: args.fingerprintOs,
      listIds: [],
      lastOpenedAt: undefined,
      login: false,
      dailyScrapingLimit: normalizeDailyScrapingLimit(args.dailyScrapingLimit),
      dailyScrapingUsed: 0,
    })

    return await ctx.db.get(id)
  },
})

export const profilesUpdateByName = internalMutation({
  args: {
    oldName: v.string(),
    name: v.string(),
    proxy: v.optional(v.string()),
    proxyType: v.optional(v.string()),
    testIp: v.optional(v.boolean()),
    fingerprintSeed: v.optional(v.string()),
    fingerprintOs: v.optional(v.string()),
    cookiesJson: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    dailyScrapingLimit: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const oldName = String(args.oldName || '').trim()
    if (!oldName) throw new Error('old_name is required')

    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_name', (q: any) => q.eq('name', oldName))
      .first()
    if (!existing) throw new Error('Profile not found')

    const name = String(args.name || '').trim()
    if (!name) throw new Error('name is required')

    const patch: Record<string, unknown> = { name }
    if (typeof args.proxy === 'string') {
      patch.proxy = args.proxy
      patch.mode = computeProfileMode(args.proxy)
    }
    if (typeof args.proxyType === 'string') patch.proxyType = args.proxyType
    if (typeof args.testIp === 'boolean') patch.testIp = args.testIp
    if (typeof args.fingerprintSeed === 'string') patch.fingerprintSeed = args.fingerprintSeed
    if (typeof args.fingerprintOs === 'string') patch.fingerprintOs = args.fingerprintOs
    if (typeof args.cookiesJson === 'string') {
      const cookiesJson = args.cookiesJson.trim()
      patch.cookiesJson = cookiesJson || undefined
    }
    if (typeof args.sessionId === 'string') {
      const sessionId = args.sessionId.trim()
      patch.sessionId = sessionId || undefined
    }
    if (typeof args.dailyScrapingLimit === 'number') {
      patch.dailyScrapingLimit = normalizeDailyScrapingLimit(args.dailyScrapingLimit)
    } else if (args.dailyScrapingLimit === null) {
      patch.dailyScrapingLimit = undefined
    }

    await ctx.db.patch(existing._id, patch as any)
    return await ctx.db.get(existing._id)
  },
})

export const profilesRemoveByName = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = String(args.name || '').trim()
    if (!name) throw new Error('name is required')

    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_name', (q: any) => q.eq('name', name))
      .first()
    if (!existing) return true

    await ctx.db.delete(existing._id)
    return true
  },
})

export const listsList = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('lists').collect()
    rows.sort((a: any, b: any) => a.createdAt - b.createdAt)
    return rows
  },
})

export const workflowsList = internalQuery({
  args: {
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listWorkflows(ctx, args.status)
  },
})
