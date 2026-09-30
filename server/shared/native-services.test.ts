import { test, expect } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import WebSocket from 'ws'

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

async function start(name: string, mode: string, env: Record<string, string>) {
  const binary = path.resolve('target/debug', name + (process.platform === 'win32' ? '.exe' : ''))
  const proc = spawn(binary, [mode], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let output = '', errors = ''
  proc.stdout.on('data', chunk => { output += chunk })
  proc.stderr.on('data', chunk => { errors += chunk })
  proc.on('error', error => { errors += error.message })
  const url = `http://127.0.0.1:${env.RUNTIME_PORT || env.SPOOFER_PORT}`
  async function stop() {
    if (proc.exitCode !== null || proc.signalCode || !proc.pid) return
    const exited = new Promise<void>(resolve => proc.once('exit', () => resolve()))
    if (mode === 'helper') proc.stdin.end('stop\n'); else proc.kill()
    const timer = setTimeout(() => proc.kill(), 3000)
    try { await exited } finally { clearTimeout(timer) }
  }
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (proc.exitCode !== null) throw new Error(`Native service failed: ${errors}`)
      try { if ((await fetch(`${url}/health`)).ok) return { url, logs: () => output.split('\n').filter(Boolean).map(line => JSON.parse(line)), stop } } catch { /* waiting for bind */ }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error(`Build native services with cargo build --workspace. ${errors}`)
  } catch (error) { await stop(); throw error }
}

test('native spoofer preserves responses, EXIF, pixel uniqueness and safe correlated logs', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'ig-spoofer-test-'))
  const directory = path.join(root, 'model123', 'posts', '11111111-1111-4111-8111-111111111111')
  await fs.mkdir(directory, { recursive: true })
  const source = path.join(directory, 'source.jpg')
  await sharp({ create: { width: 96, height: 64, channels: 3, background: '#528cba' } }).jpeg().withMetadata({ orientation: 6 }).toFile(source)
  const service = await start('spoof', 'serve', { SPOOFER_PORT: String(await freePort()), SPOOFER_DATA_ROOT: root })
  const send = (body: string) => fetch(`${service.url}/variants`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'test-request-123' }, body })
  try {
    const response = await send(JSON.stringify({ source }))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('test-request-123')
    const result = await response.json() as { outputs: { name: string; hash: string }[]; failures: unknown[] }
    expect(result.outputs.length).toBe(50)
    expect(result.failures).toEqual([])
    expect(new Set(result.outputs.map(row => row.hash)).size).toBe(50)
    const metadata = await sharp(path.join(directory, 'variants', result.outputs[0].name)).metadata()
    expect(metadata.width).toBe(64)
    expect(metadata.height).toBe(96)
    expect(metadata.exif?.includes(Buffer.from('Apple'))).toBe(true)
    await fs.writeFile(source, 'invalid image')
    expect((await send(JSON.stringify({ source }))).status).toBe(422)
    expect((await send('{"password":"private-value"')).status).toBe(400)
    expect((await fetch(`${service.url}/health`)).status).toBe(200)
    await new Promise(resolve => setTimeout(resolve, 30))
    const logs = service.logs()
    const success = logs.find(log => log.context.outputCount === 50)
    expect(success.requestId).toBe('test-request-123')
    expect(success.source).toBe('spoofer')
    expect(success.context.modelId).toBe('model123')
    expect(logs.some(log => log.level === 'error' && log.outcome === 'error')).toBe(true)
    expect(JSON.stringify(logs).includes('private-value')).toBe(false)
    expect(JSON.stringify(logs).includes(source)).toBe(false)
  } finally { await service.stop(); await fs.rm(root, { recursive: true, force: true }) }
}, 60_000)

test('native helper wakes and cancels jobs, stages uploads and deletes their files', async () => {
  const service = await start('ig-runtime', 'helper', { RUNTIME_PORT: String(await freePort()) })
  const post = (route: string, body: BodyInit, json = false) => fetch(service.url + route, { method: 'POST', headers: json ? { 'Content-Type': 'application/json' } : {}, body })
  try {
    await post('/schedules/cancelled', JSON.stringify({ dueAt: Date.now() + 60_000 }), true)
    await fetch(service.url + '/schedules/cancelled', { method: 'DELETE' })
    const due = fetch(service.url + '/schedules/due')
    await post('/schedules/ready', JSON.stringify({ dueAt: Date.now() + 30 }), true)
    expect(await (await due).json()).toEqual(['ready'])
    const response = await post('/uploads?kind=photo', new Uint8Array([255, 216, 255, 217]))
    const file = await response.json() as { id: string; path: string; size: number }
    expect(response.status).toBe(200)
    expect(file.size).toBe(4)
    expect(await fs.readFile(file.path)).toEqual(Buffer.from([255, 216, 255, 217]))
    await fetch(service.url + '/uploads/' + file.id, { method: 'DELETE' })
    expect(await fs.stat(file.path).catch(() => null)).toBeNull()
    expect((await post('/uploads?kind=photo', 'invalid')).status).toBe(422)
    expect((await post('/uploads?kind=video', new Uint8Array(25_000_001))).status).toBe(413)
    if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) {
      const audio = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=44100', '-t', '0.1', '-f', 'mp3', 'pipe:1'])
      expect(audio.status).toBe(0)
      const voice = await (await post('/uploads?kind=voice', audio.stdout)).json() as { id: string; path: string; voiceConverted: boolean }
      expect(voice.voiceConverted).toBe(true)
      expect((await fs.readFile(voice.path)).toString('ascii', 4, 8)).toBe('ftyp')
      await fetch(service.url + '/uploads/' + voice.id, { method: 'DELETE' })
    }
  } finally { await service.stop() }
}, 30_000)

test('Rust gateway relays binary RFB data in both directions and releases disconnected sockets', async () => {
  let port = 5901
  const tcp = createServer(socket => {
    socket.write('RFB 003.008\n')
    socket.on('data', chunk => socket.write(chunk))
  })
  for (; port <= 5950; port++) {
    const opened = await new Promise<boolean>(resolve => {
      const failed = () => resolve(false)
      tcp.once('error', failed)
      tcp.listen(port, '127.0.0.1', () => { tcp.off('error', failed); resolve(true) })
    })
    if (opened) break
  }
  const service = await start('ig-runtime', 'gateway', { RUNTIME_PORT: String(await freePort()), VNC_UPSTREAM_HOST: '127.0.0.1' })
  let ws: WebSocket | undefined
  try {
    ws = new WebSocket(service.url.replace('http', 'ws') + `/vnc/${port + 180}/websockify`, 'binary')
    const received: Buffer[] = []
    ws.on('message', (data, binary) => { expect(binary).toBe(true); received.push(data as Buffer) })
    await new Promise<void>((resolve, reject) => { ws!.once('open', resolve); ws!.once('error', reject) })
    expect(ws.protocol).toBe('binary')
    const payload = Buffer.alloc(180_000, 42)
    ws.send(payload)
    const deadline = Date.now() + 3000
    while (Buffer.concat(received).length < 12 + payload.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    expect(Buffer.concat(received)).toEqual(Buffer.concat([Buffer.from('RFB 003.008\n'), payload]))
    const closed = new Promise<void>(resolve => ws!.once('close', () => resolve()))
    ws.close(); await closed
  } finally { ws?.terminate(); await service.stop(); await new Promise<void>(resolve => tcp.close(() => resolve())) }
}, 15_000)
