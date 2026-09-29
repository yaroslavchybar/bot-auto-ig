import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'
import { LogScope, runInLogScope } from '../shared/logger.js'
import { REQUEST_ID_PATTERN } from '../shared/loggingTypes.js'

/** Attach before parsers/auth so malformed, rejected, and aborted requests are logged too. */
export const requestLogging: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id')
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID()
  const scope = new LogScope('http.request', { requestId, method: req.method, path: req.path })
  res.setHeader('x-request-id', requestId)
  const finish = (aborted: boolean) => {
    scope.add({ statusCode: res.statusCode, aborted })
    scope.finish(aborted ? 'cancelled' : res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'rejected' : 'success')
  }
  res.once('finish', () => finish(false))
  res.once('close', () => { if (!res.writableFinished) finish(true) })
  runInLogScope(scope, next)
}
