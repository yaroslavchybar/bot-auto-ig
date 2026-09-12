import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'

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
