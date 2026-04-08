import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'

function normalizeUserName(userName: string): string {
  let normalized = String(userName || '').trim()
  if (normalized.startsWith('@')) normalized = normalized.slice(1)
  normalized = normalized.replace(/\/+$/, '')
  return normalized.trim().toLowerCase()
}

export const insertBatchInternal = internalMutation({
  args: {
    accounts: v.array(
      v.object({
        userName: v.string(),
        status: v.optional(
          v.union(v.literal('need_scraping'), v.literal('done')),
        ),
        createdAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const insertedIds = []
    let skipped = 0
    const seen = new Set<string>()

    for (const account of args.accounts) {
      const userName = normalizeUserName(account.userName)
      if (!userName) {
        skipped += 1
        continue
      }

      if (seen.has(userName)) {
        skipped += 1
        continue
      }
      seen.add(userName)

      const existing = await ctx.db
        .query('scrapingAccounts')
        .withIndex('by_userName', (q) => q.eq('userName', userName))
        .first()
      if (existing) {
        skipped += 1
        continue
      }

      const id = await ctx.db.insert('scrapingAccounts', {
        userName,
        status: account.status ?? 'need_scraping',
        createdAt: account.createdAt ?? Date.now(),
      })
      insertedIds.push(id)
    }

    return { inserted: insertedIds.length, skipped, ids: insertedIds }
  },
})

export const listByStatusInternal = internalQuery({
  args: {
    status: v.optional(
      v.union(v.literal('need_scraping'), v.literal('done')),
    ),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      const rows = await ctx.db
        .query('scrapingAccounts')
        .withIndex('by_status', (q) => q.eq('status', args.status!))
        .collect()
      rows.sort((a, b) => a.createdAt - b.createdAt)
      return rows
    }
    const rows = await ctx.db.query('scrapingAccounts').collect()
    rows.sort((a, b) => a.createdAt - b.createdAt)
    return rows
  },
})

export const updateStatusInternal = internalMutation({
  args: {
    accountId: v.id('scrapingAccounts'),
    status: v.union(v.literal('need_scraping'), v.literal('done')),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, { status: args.status })
    return await ctx.db.get(args.accountId)
  },
})
