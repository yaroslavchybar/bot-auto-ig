import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { AppError } from './errors.js'
import { resolveProjectRoot } from './utils.js'
import { currentRequestId } from './logger.js'

export const runtimeUrl = () => process.env.RUNTIME_URL || 'http://127.0.0.1:3004'
let helper: ChildProcess | undefined
export function runtimeHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Request-Id': currentRequestId() || crypto.randomUUID(),
    Authorization: 'Bearer ' + (process.env.INTERNAL_API_KEY?.trim() || ''),
  }
}
export async function stopRuntime(): Promise<void> {
  const child = helper
  helper = undefined
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.stdin?.end('stop\n')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, 60_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export async function runtimeRequest<T>(route: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(runtimeHeaders())
  new Headers(options.headers).forEach((value, key) => headers.set(key, value))
  const response = await fetch(`${runtimeUrl()}${route}`, {
    ...options,
    headers,
    signal: options.signal ?? AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string }
    }
    throw new AppError(
      body.error?.message || 'Rust runtime request failed',
      response.status,
      body.error?.code || 'RUNTIME_ERROR',
    )
  }
  return response.json() as Promise<T>
}

/** A managed server starts the native controller directly; local development starts one helper. */
export async function startRuntime(): Promise<void> {
  if (process.env.RUNTIME_MANAGED === '1') return
  try {
    await runtimeRequest('/health', { signal: AbortSignal.timeout(1000) })
    return
  } catch {
    /* start locally */
  }
  const root = resolveProjectRoot(import.meta.url)
  const name = process.platform === 'win32' ? 'ig-runtime.exe' : 'ig-runtime'
  const binary =
    process.env.RUNTIME_BINARY ||
    ['release', 'debug']
      .map((mode) => path.join(root, 'target', mode, name))
      .filter((file) => fs.existsSync(file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  if (!binary) throw new Error('Rust runtime is missing. Run cargo build --workspace first.')
  helper = spawn(binary, ['helper'], {
    cwd: root,
    env: { ...process.env, PROJECT_ROOT: root },
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true,
  })
  let failure: Error | undefined
  helper.on('error', (error) => {
    failure = error
  })
  helper.stdin?.on('error', () => {})
  for (let attempt = 0; attempt < 50; attempt++) {
    if (failure) throw failure
    if (helper.exitCode !== null) throw new Error('Rust runtime stopped before startup')
    try {
      await runtimeRequest('/health', { signal: AbortSignal.timeout(1000) })
      return
    } catch {
      /* retry startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Rust runtime startup timed out')
}
