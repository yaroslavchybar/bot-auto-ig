import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** Fixtures never read or write real app data, or connect to a real deployment. */
export async function nativeFixture(env: Record<string, string> = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'ig-native-fixture-'))
  const port = await freePort(),
    publicPort = await freePort()
  const binary = path.resolve(
    'target/debug/ig-runtime' + (process.platform === 'win32' ? '.exe' : ''),
  )
  const proc = spawn(binary, ['helper'], {
    env: {
      ...process.env,
      PROJECT_ROOT: root,
      MODEL_CONTENT_DIR: path.join(root, 'data/model-content'),
      CONVEX_URL: '',
      VITE_CONVEX_URL: '',
      INTERNAL_API_KEY: 'fixture-key',
      RUNTIME_PORT: String(port),
      SERVER_PORT: String(publicPort),
      VNC_GATEWAY_PORT: '0',
      WORKER_PORT: '0',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_BOT_USERNAME: '',
      PUBLIC_BASE_URL: '',
      APP_PUBLIC_URL: '',
      NODE_ENV: 'development',
      DISABLE_AUTH: 'true',
      ...env,
    },
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  })
  let errors = ''
  proc.stderr.on('data', (chunk) => {
    errors = (errors + chunk).slice(-4096)
  })
  proc.on('error', (error) => {
    errors = error.message
  })
  proc.stdin.on('error', () => {})
  const url = 'http://127.0.0.1:' + port
  const headers = { Authorization: 'Bearer fixture-key', 'Content-Type': 'application/json' }
  const stop = async () => {
    if (proc.exitCode === null && !proc.signalCode) {
      const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()))
      proc.stdin.end('stop\n')
      const timer = setTimeout(() => proc.kill(), 5000)
      await exited
      clearTimeout(timer)
    }
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()))
      throw new Error('Invalid fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (proc.exitCode !== null) throw new Error('Native fixture failed: ' + errors)
      try {
        if ((await fetch(url + '/health')).ok)
          return { url, publicUrl: 'http://127.0.0.1:' + publicPort, root, headers, proc, stop }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('Native fixture did not start: ' + errors)
  } catch (error) {
    await stop()
    throw error
  }
}
