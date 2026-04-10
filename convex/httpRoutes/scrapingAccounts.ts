import type { HttpRouter } from 'convex/server'
import { internal } from '../_generated/api'
import {
  chunkArray,
  formatChunkFailureMessage,
  jsonResponse,
  parseBody,
  registerPreflight,
  withErrorHandling,
} from './shared'

const internalApi = internal as any

const scrapingAccountPaths = [
  '/api/scraping-accounts/batch',
  '/api/scraping-accounts/by-status',
  '/api/scraping-accounts/update-status',
]

export function registerScrapingAccountRoutes(http: HttpRouter): void {
  registerPreflight(http, scrapingAccountPaths)

  http.route({
    path: '/api/scraping-accounts/batch',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request)
      const accounts = Array.isArray(body?.accounts) ? body.accounts : []
      const batches = chunkArray(accounts)
      let inserted = 0
      let skipped = 0
      const ids: unknown[] = []

      for (const [index, batch] of batches.entries()) {
        try {
          const result = await ctx.runMutation(internalApi.scrapingAccounts.insertBatchInternal, {
            accounts: batch,
          })
          inserted += Number(result?.inserted ?? 0)
          skipped += Number(result?.skipped ?? 0)
          if (Array.isArray(result?.ids)) {
            ids.push(...result.ids)
          }
        } catch (error) {
          const message = formatChunkFailureMessage({
            operation: 'Bulk scraping account archive',
            inserted,
            skipped,
            completedBatches: index,
            totalBatches: batches.length,
            error,
          })
          console.error(message)
          throw new Error(message)
        }
      }

      return jsonResponse({ inserted, skipped, ids })
    }),
  })

  http.route({
    path: '/api/scraping-accounts/by-status',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url)
      const status = url.searchParams.get('status') || undefined
      const accounts = await ctx.runQuery(internalApi.scrapingAccounts.listByStatusInternal, {
        status,
      })
      return jsonResponse(accounts.map((a: any) => ({
        id: a._id,
        user_name: a.userName,
        status: a.status,
        created_at: a.createdAt,
      })))
    }),
  })

  http.route({
    path: '/api/scraping-accounts/update-status',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request)
      const updated = await ctx.runMutation(internalApi.scrapingAccounts.updateStatusInternal, {
        accountId: (body?.accountId ?? body?.account_id ?? body?.id) as any,
        status: body?.status,
      })
      return jsonResponse(updated ? {
        id: updated._id,
        user_name: updated.userName,
        status: updated.status,
        created_at: updated.createdAt,
      } : null)
    }),
  })
}
