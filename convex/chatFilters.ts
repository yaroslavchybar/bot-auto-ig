import { query } from './_generated/server'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'

// Subscribe only to contacts already in the device's inbox, without downloading scraped leads.
export const contacts = query({
  args: {
    contacts: v.array(v.object({ profileId: v.string(), igId: v.string(), username: v.string() })),
  },
  handler: async (ctx, args) => {
    if (args.contacts.length > 2000) throw new Error('Too many Chat contacts')
    const lists = new Set((await ctx.db.query('leadLists').collect()).map((row) => row._id))
    const leads = new Map<string, Promise<Doc<'leads'> | null>>()
    const memberships = new Map<Id<'leads'>, Promise<Id<'leadLists'>[]>>()
    return Promise.all(
      args.contacts.map(async ({ profileId, igId, username }) => {
        const key = `${igId}:${username.toLowerCase()}`
        if (!leads.has(key))
          leads.set(
            key,
            (async () => {
              if (!/^\d{1,40}$/.test(igId)) return null
              const lead = await ctx.db
                .query('leads')
                .withIndex('by_ig_id', (q) => q.eq('igId', igId))
                .first()
              if (lead) return lead
              const byName = await ctx.db
                .query('leads')
                .withIndex('by_username', (q) => q.eq('username', username.toLowerCase()))
                .first()
              // Never assign a known ID belonging to a different account with the same username.
              return byName && (!byName.igId || byName.igId === igId) ? byName : null
            })(),
          )
        const lead = await leads.get(key)!
        let listIds: Id<'leadLists'>[] = []
        if (lead?.senderId === profileId && lead.dmSent && lead.outreachListId) {
          listIds = lists.has(lead.outreachListId) ? [lead.outreachListId] : []
        } else if (lead) {
          if (!memberships.has(lead._id))
            memberships.set(
              lead._id,
              ctx.db
                .query('leadMemberships')
                .withIndex('by_lead_list', (q) => q.eq('leadId', lead._id))
                .collect()
                .then((rows) => rows.map((row) => row.listId).filter((id) => lists.has(id))),
            )
          listIds = await memberships.get(lead._id)!
        }
        return { profileId, igId, listIds }
      }),
    )
  },
})
