import type { RequestListener } from 'node:http'
import { Commands, commandResponse, type CommandRequest } from './commands.js'
import { AppError } from '../shared/errors.js'

/** Invoke real worker operations in isolation; public routing is tested in Rust. */
export function commandTestHandler(commands: Commands, prefix = ''): RequestListener {
  return (incoming, outgoing) => {
    const url = new URL(incoming.url || '/', 'http://localhost')
    const response = commandResponse(outgoing)
    const fail = (error: unknown) => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      const status = error instanceof AppError ? error.statusCode : 500
      response.status(status).json({
        success: false,
        error: {
          code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof AppError ? error.message : 'Internal server error',
        },
      })
    }
    for (const operation of commands.operations) {
      if (operation.method !== 'ALL' && operation.method !== incoming.method) continue
      const names: string[] = []
      const pattern = (prefix + (operation.path === '/' ? '' : operation.path))
        .split('/')
        .map((part) => {
          if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          names.push(part.slice(1))
          return '([^/]+)'
        })
        .join('/')
      const match = url.pathname.match(new RegExp(`^${pattern}/?$`))
      if (!match) continue
      void (async () => {
        const request = incoming as CommandRequest
        request.params = Object.fromEntries(
          names.map((name, index) => [name, decodeURIComponent(match[index + 1])]),
        )
        request.query = Object.fromEntries(url.searchParams)
        request.url = '/' + url.search
        if (operation.body !== 'stream') {
          const chunks: Buffer[] = []
          for await (const chunk of request) chunks.push(Buffer.from(chunk))
          const bytes = Buffer.concat(chunks)
          request.body =
            operation.body === 'raw'
              ? bytes
              : bytes.length
                ? JSON.parse(bytes.toString('utf8'))
                : {}
        }
        await operation.handler(request, response, fail)
      })().catch(fail)
      return
    }
    response.sendStatus(404)
  }
}
