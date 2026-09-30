import fs from 'node:fs'
import path from 'node:path'
import { spawnNative, type ChildProcess } from './ProcessService.js'
import { resolveProjectRoot } from './utils.js'
import { currentRequestId } from './logger.js'

export const runtimeUrl = () => process.env.RUNTIME_URL || 'http://127.0.0.1:3004'
let helper: ChildProcess | undefined

export async function runtimeRequest<T>(route: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${runtimeUrl()}${route}`, {
    ...options, headers: { 'Content-Type': 'application/json', 'X-Request-Id': currentRequestId() || crypto.randomUUID(), ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Rust runtime HTTP ${response.status}`)
  return response.json() as Promise<T>
}

/** Containers start the native controller directly; local development starts one helper. */
export async function startRuntime(): Promise<void> {
  if (process.env.RUNTIME_MANAGED === '1') return
  try { await runtimeRequest('/health', { signal: AbortSignal.timeout(1000) }); return } catch { /* start locally */ }
  const root = resolveProjectRoot(import.meta.url)
  const name = process.platform === 'win32' ? 'ig-runtime.exe' : 'ig-runtime'
  const binary = process.env.RUNTIME_BINARY || ['release', 'debug'].map(mode => path.join(root, 'target', mode, name)).find(file => fs.existsSync(file))
  if (!binary) throw new Error('Rust runtime is missing. Run cargo build --workspace first.')
  helper = spawnNative(binary, ['helper'])
  for (let attempt = 0; attempt < 50; attempt++) {
    if (helper.exitCode !== null) throw new Error('Rust runtime stopped before startup')
    try { await runtimeRequest('/health', { signal: AbortSignal.timeout(1000) }); return } catch { /* retry startup */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Rust runtime startup timed out')
}
