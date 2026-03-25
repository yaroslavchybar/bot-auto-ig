/**
 * Wraps an async Express route handler so that rejected promises
 * are forwarded to the global error-handling middleware via next().
 *
 * Usage:
 *   router.get('/items', asyncHandler(async (req, res) => { ... }))
 */
import type { Request, Response, NextFunction } from 'express'

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<any>

export function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
