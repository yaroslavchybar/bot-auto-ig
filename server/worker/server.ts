import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { AppError } from '../shared/errors.js'
import { LogScope, runInLogScope } from '../shared/logger.js'
import { Sentry } from '../shared/sentry.js'
import type { Commands } from './commands.js'

export function isWorkerAuthorized(request: IncomingMessage): boolean {
  const key = process.env.INTERNAL_API_KEY?.trim()
  if (!key) return false
  const actual = Buffer.from(request.headers.authorization || '')
  const expected = Buffer.from(`Bearer ${key}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(value))
}

/** Loopback-only JSON callbacks. Axum owns public routing and policy. */
export function createWorkerServer(commands: Commands) {
  return createServer((request, response) => {
    if (!isWorkerAuthorized(request)) return json(response, 401, { error: 'Unauthorized' })
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname
    if (path === '/health') return json(response, 200, { ok: true })
    if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' })
    const operation = path.slice('/commands/'.length)
    const handler =
      path.startsWith('/commands/') && Object.hasOwn(commands, operation)
        ? commands[operation]
        : undefined
    if (!handler) return json(response, 404, { error: 'Unknown worker command' })
    const controller = new AbortController()
    const scope = new LogScope('worker.command', {
      operation,
      method: 'POST',
      requestId: request.headers['x-request-id'],
    })
    response.once('finish', () => {
      scope.add({ statusCode: response.statusCode })
      scope.finish(
        response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'rejected' : 'success',
      )
    })
    response.once('close', () => {
      if (response.writableFinished) return
      controller.abort(new Error('Worker client disconnected'))
      scope.add({ responseAborted: true, ...(response.headersSent ? { statusCode: response.statusCode } : {}) })
      scope.finish(scope.fields.error ? 'error' : 'cancelled')
    })
    runInLogScope(scope, () => {
      void (async () => {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of request.iterator({ destroyOnReturn: false })) {
          size += chunk.length
          if (size > 1024 * 1024)
            throw new AppError('Request body too large', 413, 'PAYLOAD_TOO_LARGE')
          chunks.push(Buffer.from(chunk))
        }
        let body: unknown
        try {
          body = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
        } catch {
          throw new AppError('Invalid JSON body', 400, 'VALIDATION_ERROR')
        }
        controller.signal.throwIfAborted()
        const value = await handler({ body, signal: controller.signal })
        if (!response.destroyed) json(response, 200, value)
      })().catch((error) => {
        scope.add({ error })
        if (response.destroyed) return
        if (error instanceof AppError) {
          if (error.statusCode === 413) response.setHeader('Connection', 'close')
          json(response, error.statusCode, {
            success: false,
            error: { code: error.code, message: error.message },
          })
        } else {
          Sentry.captureException(error)
          json(response, 500, {
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
          })
        }
      })
    })
  })
}
