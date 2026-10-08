import { createServer, type IncomingMessage } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { AppError } from '../shared/errors.js'
import { LogScope, runInLogScope } from '../shared/logger.js'
import { Sentry } from '../shared/sentry.js'
import { Commands, commandResponse, type CommandRequest } from './commands.js'

export function isWorkerAuthorized(request: IncomingMessage): boolean {
  const key = process.env.INTERNAL_API_KEY?.trim()
  if (!key) return false
  const actual = Buffer.from(request.headers.authorization || '')
  const expected = Buffer.from(`Bearer ${key}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Loopback-only browser action transport. Axum owns public HTTP policy. */
export function createWorkerServer(groups: Commands[]) {
  const operations = new Map(
    groups.flatMap((group) => group.operations).map((operation) => [operation.id, operation]),
  )
  return createServer((incoming, outgoing) => {
    const response = commandResponse(outgoing)
    if (!isWorkerAuthorized(incoming)) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const url = new URL(incoming.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/health') {
      response.json({ ok: true })
      return
    }
    if (incoming.method !== 'POST') {
      response.sendStatus(405)
      return
    }
    const operation = operations.get(url.pathname.slice('/commands/'.length))
    if (!url.pathname.startsWith('/commands/') || !operation) {
      response.status(404).json({ error: 'Unknown worker command' })
      return
    }
    const scope = new LogScope('worker.command', {
      operation: operation.id,
      requestId: incoming.headers['x-request-id'],
    })
    const fail = (error: unknown) => {
      scope.add({ error })
      if (response.headersSent || response.destroyed) {
        response.destroy()
        return
      }
      if (error instanceof AppError)
        response
          .status(error.statusCode)
          .json({ success: false, error: { code: error.code, message: error.message } })
      else {
        Sentry.captureException(error)
        response.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        })
      }
    }
    response.once('finish', () => {
      scope.add({ statusCode: response.statusCode })
      scope.finish(
        response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'rejected' : 'success',
      )
    })
    runInLogScope(scope, () => {
      void (async () => {
        const request = incoming as CommandRequest
        const rawParams = incoming.headers['x-worker-params']
        request.params =
          typeof rawParams === 'string'
            ? JSON.parse(Buffer.from(rawParams, 'base64url').toString('utf8'))
            : {}
        request.query = Object.fromEntries(url.searchParams)
        request.method =
          operation.method === 'ALL'
            ? String(incoming.headers['x-worker-method'] || 'GET')
            : operation.method
        // File picker routing retains its original query string; the command path is private.
        request.url = '/' + url.search
        if (operation.body !== 'stream') {
          const chunks: Buffer[] = []
          let size = 0
          const limit = operation.body === 'raw' ? 15 * 1024 * 1024 : 1024 * 1024
          for await (const chunk of incoming) {
            size += chunk.length
            if (size > limit) throw new AppError('Request body too large', 413, 'PAYLOAD_TOO_LARGE')
            chunks.push(Buffer.from(chunk))
          }
          const bytes = Buffer.concat(chunks)
          if (operation.body === 'raw') request.body = bytes
          else {
            try {
              request.body = bytes.length ? JSON.parse(bytes.toString('utf8')) : {}
            } catch {
              throw new AppError('Invalid JSON body', 400, 'VALIDATION_ERROR')
            }
          }
        }
        await operation.handler(request, response, fail)
      })().catch(fail)
    })
  })
}
