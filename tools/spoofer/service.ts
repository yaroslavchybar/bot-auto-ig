import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { startRequestLog, addRequestContext } from '../../server/shared/httpLogging.js'

const root = path.resolve(process.env.SPOOFER_DATA_ROOT || '/app/data/model-content')
const binary = process.env.SPOOF_BINARY || '/usr/local/bin/spoof'
let queue: Promise<unknown> = Promise.resolve()

function sourcePath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid source path')
  const source = path.resolve(value)
  const parts = path.relative(root, source).split(path.sep)
  if (parts.length !== 4 || !/^[a-zA-Z0-9_-]{4,100}$/.test(parts[0]) ||
    !['posts', 'avatars'].includes(parts[1]) ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(parts[2]) ||
    !/^source\.(jpg|jpeg|png|webp)$/i.test(parts[3])) throw new Error('Invalid source path')
  return source
}

function execute(source: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const output = path.join(path.dirname(source), 'variants')
    const arguments_ = ['variants', source, '--copies', '50', '--output-dir', output, '--json']
    const windows = process.platform === 'win32'
    const child = spawn(windows ? binary : 'nice', windows ? arguments_ : ['-n', '10', binary, ...arguments_],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: !windows, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const killGroup = () => {
      if (child.pid) try {
        if (windows) child.kill('SIGKILL')
        else process.kill(-child.pid, 'SIGKILL')
      } catch { /* already stopped */ }
    }
    const timeout = setTimeout(killGroup, 29 * 60_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      if (stdout.length > 2 * 1024 * 1024) killGroup()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      if (stderr.length > 16_384) stderr = stderr.slice(-16_384)
    })
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timeout)
      if (code !== 0) {
        try { reject(new Error(String((JSON.parse(stdout) as { error?: string }).error || 'Spoofer failed'))) }
        catch { reject(new Error(stderr.slice(-500) || 'Spoofer failed')) }
        return
      }
      try { resolve(JSON.parse(stdout)) }
      catch { reject(new Error('Spoofer returned invalid JSON')) }
    })
  })
}

export async function handleRequest(request: Request, server: { timeout: (request: Request, seconds: number) => void }, run = execute): Promise<Response> {
  const log = startRequestLog(request, 'spoofer')
  let response: Response | undefined
  let failure: unknown
  let processing = false
  try {
    const pathname = new URL(request.url).pathname
    if (request.method === 'GET' && pathname === '/health')
      return response = Response.json({ ok: true })
    if (request.method !== 'POST' || pathname !== '/variants')
      return response = Response.json({ error: 'Not found' }, { status: 404 })
    server.timeout(request, 0)
    try {
      const body = await request.text()
      if (body.length > 2048) throw new Error('Request too large')
      const source = sourcePath((JSON.parse(body) as { source?: unknown }).source)
      const [modelId, contentKind, sourceId] = path.relative(root, source).split(path.sep)
      addRequestContext(request, { modelId, contentKind, sourceId })
      if (!(await fs.stat(source)).isFile()) throw new Error('Source image is missing')
      processing = true
      const queuedAt = Date.now()
      const job = queue.then(() => {
        addRequestContext(request, { queueWaitMs: Date.now() - queuedAt })
        return run(source)
      })
      queue = job.catch(() => undefined)
      const result = await job as { outputs?: unknown[]; failures?: unknown[] }
      addRequestContext(request, { outputCount: result.outputs?.length ?? 0, failureCount: result.failures?.length ?? 0 })
      return response = Response.json(result)
    } catch (error) {
      failure = error instanceof SyntaxError ? new Error('Invalid request JSON') : error
      return response = Response.json({ error: error instanceof Error ? error.message : 'Spoofer failed' }, { status: 422 })
    }
  } finally {
    response?.headers.set('X-Request-Id', log.requestId)
    log.finish(response?.status ?? 500, failure, processing && failure !== undefined)
  }
}

if (import.meta.main) Bun.serve({ port: 3002, hostname: '0.0.0.0', fetch: handleRequest })
