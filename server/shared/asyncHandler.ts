/**
 * Wraps an async Express route handler so that rejected promises
 * are forwarded to the global error-handling middleware via next().
 *
 * Usage:
 *   router.get('/items', asyncHandler(async (req, res) => { ... }))
 */
import type { Request, Response, NextFunction } from 'express'
import { addLogContext } from './logger.js'

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<any>

export function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only identifiers and operation names; request bodies may contain credentials or messages.
    const keys = ['profileId', 'profileName', 'automationId', 'jobId', 'accountId', 'modelId', 'listId', 'threadId', 'action']
    const fields: Record<string, unknown> = {}
    if (typeof req.params.name === 'string') fields.profileName = req.params.name
    for (const key of keys) {
      const value = req.params[key] ?? req.body?.[key]
      if (typeof value === 'string' && value.length <= 128) fields[key] = value
    }
    addLogContext({ ...fields, path: `${req.baseUrl}${req.route?.path || req.path}` })
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
