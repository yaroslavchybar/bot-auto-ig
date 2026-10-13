import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Fixtures never read or write real app data, or connect to a real deployment. */
export async function nativeFixture(env: Record<string, string> = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'ig-native-fixture-'))
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
      RUNTIME_PORT: '0',
      SERVER_PORT: '0',
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
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let errors = ''
  let failure: Error | undefined
  let output = ''
  let ports: { runtimePort: number; serverPort: number; gatewayPort: number } | undefined
  proc.stdout.on('data', (chunk) => {
    output += chunk
    let end: number
    while ((end = output.indexOf('\n')) >= 0) {
      const line = output.slice(0, end)
      output = output.slice(end + 1)
      try {
        const event = JSON.parse(line)
        if (
          event.event === 'runtime.ready' &&
          ['runtimePort', 'serverPort', 'gatewayPort'].every(
            (key) =>
              Number.isInteger(event.context?.[key]) &&
              event.context[key] > 0 &&
              event.context[key] <= 65535,
          )
        )
          ports = event.context
      } catch {}
    }
  })
  proc.stderr.on('data', (chunk) => {
    errors = (errors + chunk).slice(-4096)
  })
  proc.on('error', (error) => {
    failure = error
    errors = error.message
  })
  proc.stdin.on('error', () => {})
  const headers = { Authorization: 'Bearer fixture-key', 'Content-Type': 'application/json' }
  const stop = async () => {
    if (proc.exitCode === null && !proc.signalCode && proc.pid) {
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
      if (proc.exitCode !== null || proc.signalCode || failure)
        throw new Error('Native fixture failed: ' + errors)
      try {
        const url = ports && 'http://127.0.0.1:' + ports.runtimePort
        if (url && (await fetch(url + '/health', { signal: AbortSignal.timeout(500) })).ok)
          return {
            url,
            publicUrl: 'http://127.0.0.1:' + ports!.serverPort,
            gatewayUrl: 'http://127.0.0.1:' + ports!.gatewayPort,
            root,
            headers,
            proc,
            stop,
          }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('Native fixture did not start: ' + errors)
  } catch (error) {
    await stop()
    throw error
  }
}
