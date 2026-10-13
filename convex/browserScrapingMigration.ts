import { internalMutation } from './_generated/server'
import type { GenericDatabaseWriter, GenericDataModel } from 'convex/server'
import { syncWorkerProfile } from './workerMetadata'
import type { Id } from './_generated/dataModel'
import type { GenericId } from 'convex/values'

type OldRow = {
  _id: GenericId<string>
  profileId: Id<'profiles'>
  storageId?: Id<'_storage'>
  requests?: Array<{ id: string; at: number }>
  sleepUntil?: number
}

/** Temporary cleanup for the removed mobile subsystem. Remove after deployment completes. */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Removed tables are deliberately absent from the active application schema.
    const oldDb = ctx.db as GenericDatabaseWriter<GenericDataModel>
    let removed = 0
    for (const table of ['chatSessions', 'chatWorkerMetadata', 'mobileRequestUsage']) {
      for (const row of (await oldDb.query(table).take(100)) as unknown as OldRow[]) {
        if (table === 'mobileRequestUsage' && (await ctx.db.get(row.profileId))) {
          const current = await ctx.db
            .query('scraperRequestUsage')
            .withIndex('by_profile', (q) => q.eq('profileId', row.profileId))
            .unique()
          const requests = [...(row.requests ?? []), ...(current?.requests ?? [])].filter(
            (request) => request.at > Date.now() - 3_600_000,
          )
          const unique = [
            ...new Map(requests.map((request) => [request.id, request])).values(),
          ].sort((a, b) => a.at - b.at)
          const sleepUntil = Math.max(row.sleepUntil ?? 0, current?.sleepUntil ?? 0) || undefined
          if (current) await ctx.db.patch(current._id, { requests: unique, sleepUntil })
          else
            await ctx.db.insert('scraperRequestUsage', {
              profileId: row.profileId,
              requests: unique,
              sleepUntil,
            })
        }
        if (table === 'chatSessions') {
          if (row.storageId) await ctx.storage.delete(row.storageId)
          const profile = await ctx.db.get(row.profileId)
          if (profile) await syncWorkerProfile(ctx, profile)
        }
        await oldDb.delete(row._id)
        removed++
      }
    }
    for (const row of await ctx.db
      .query('analyticsDays')
      .filter((q) => q.neq(q.field('counts.mobileRequests'), undefined))
      .take(100)) {
      const { mobileRequests, ...counts } = row.counts
      await ctx.db.patch(row._id, {
        counts: {
          ...counts,
          scraperRequests: (counts.scraperRequests ?? 0) + (mobileRequests ?? 0),
        },
      })
      removed++
    }
    for (const row of await ctx.db.query('analyticsHistory').collect()) {
      if (row.totals.mobileRequests === undefined) continue
      const { mobileRequests, ...totals } = row.totals
      await ctx.db.patch(row._id, {
        totals: { ...totals, scraperRequests: (totals.scraperRequests ?? 0) + mobileRequests },
      })
      removed++
    }
    return { removed }
  },
})
