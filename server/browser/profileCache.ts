import fs from 'node:fs/promises'
import path from 'node:path'

// Chromium treats this as a cache budget, not a quota for the whole profile.
export const DISK_CACHE_BYTES = 128 * 1024 * 1024

const CACHE_DIRS = [
  'Default/Cache',
  'Default/Code Cache',
  'Default/GPUCache',
  'Default/Media Cache',
  'ShaderCache',
  'GrShaderCache',
  'GraphiteDawnCache',
]

/** Call only before launch, while holding worker.lock. Keep all site storage. */
export async function pruneProfileCache(profileDir: string): Promise<void> {
  const root = await fs.realpath(profileDir)
  for (const relative of CACHE_DIRS) {
    try {
      const target = path.resolve(root, relative)
      const resolved = await fs.realpath(target)
      // Do not traverse a redirected cache or Default directory.
      if (resolved !== target || !resolved.startsWith(`${root}${path.sep}`)) continue
      await fs.rm(target, { recursive: true, force: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      process.stderr.write(`Could not prune browser cache ${relative}: ${code ?? 'unknown error'}\n`)
    }
  }
}
