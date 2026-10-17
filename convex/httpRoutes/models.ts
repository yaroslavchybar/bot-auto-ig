import type { HttpRouter } from 'convex/server'
import { api, internal } from '../_generated/api'
import {
  jsonResponse,
  mapModelToApi,
  parseBody,
  registerPreflight,
  ValidationError,
  withErrorHandling,
} from './shared'

const modelPaths = ['/api/models', '/api/models/content-cleanup']

export function registerModelRoutes(http: HttpRouter): void {
  registerPreflight(http, modelPaths)
  http.route({
    path: '/api/models/content-cleanup',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request)
      if (body.operation === 'queue')
        await ctx.runMutation(internal.models.queueContentCleanupInternal, {
          contentKey: body.contentKey,
        })
      else if (body.operation === 'finish')
        await ctx.runMutation(internal.models.finishContentCleanupInternal, {
          contentKey: body.contentKey,
        })
      else throw new ValidationError('Unknown content cleanup operation')
      return jsonResponse({ ok: true })
    }),
  })

  http.route({
    path: '/api/models',
    method: 'GET',
    handler: withErrorHandling(async (ctx) => {
      const models = await ctx.runQuery(api.models.list, {})
      return jsonResponse(models.map(mapModelToApi))
    }),
  })
}
