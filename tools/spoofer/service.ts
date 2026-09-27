import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

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

Bun.serve({ port: 3002, hostname: '0.0.0.0', async fetch(request, server) {
  if (request.method === 'GET' && new URL(request.url).pathname === '/health') return Response.json({ ok: true })
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/variants')
    return Response.json({ error: 'Not found' }, { status: 404 })
  server.timeout(request, 0)
  try {
    const body = await request.text()
    if (body.length > 2048) throw new Error('Request too large')
    const source = sourcePath((JSON.parse(body) as { source?: unknown }).source)
    if (!(await fs.stat(source)).isFile()) throw new Error('Source image is missing')
    const job = queue.then(() => execute(source))
    queue = job.catch(() => undefined)
    return Response.json(await job)
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Spoofer failed' }, { status: 422 })
  }
} })
