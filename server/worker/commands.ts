import type { IncomingMessage, ServerResponse } from 'node:http'

/** Private operations exposed to Axum, never mounted as public HTTP routes. */
export type CommandRequest = IncomingMessage & {
  method: string
  url: string
  params: Record<string, string>
  query: Record<string, string | undefined>
  body: any
}
export type CommandResponse = ServerResponse & {
  status: (code: number) => CommandResponse
  json: (value: unknown) => CommandResponse
  send: (value: string | Buffer) => CommandResponse
  sendStatus: (code: number) => CommandResponse
  set: (name: string, value: string) => CommandResponse
  type: (value: string) => CommandResponse
  vary: (value: string) => CommandResponse
}
export type CommandHandler = (
  request: CommandRequest,
  response: CommandResponse,
  fail: (error: unknown) => void,
) => unknown
export type Operation = {
  id: string
  method: string
  path: string
  handler: CommandHandler
  body: 'json' | 'raw' | 'stream'
}

export class Commands {
  readonly operations: Operation[] = []
  register(
    id: string,
    method: string,
    path: string,
    handler: CommandHandler,
    body: Operation['body'] = 'json',
  ): void {
    this.operations.push({ id, method, path, handler, body })
  }
  include(group: Commands): void {
    this.operations.push(...group.operations)
  }
}

export function commandResponse(response: ServerResponse): CommandResponse {
  const output = response as CommandResponse
  output.status = (code) => {
    output.statusCode = code
    return output
  }
  output.set = (name, value) => {
    output.setHeader(name, value)
    return output
  }
  output.type = (value) =>
    output.set('Content-Type', value.includes('/') ? value : `image/${value}`)
  output.vary = (value) => output.set('Vary', value)
  output.send = (value) => {
    output.end(value)
    return output
  }
  output.json = (value) =>
    output.set('Content-Type', 'application/json').send(JSON.stringify(value))
  output.sendStatus = (code) => output.status(code).send(String(code))
  return output
}
