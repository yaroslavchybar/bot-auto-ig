import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function cloakCacheDir(): string {
  const custom = (process.env.CLOAKBROWSER_CACHE_DIR || '').trim()
  if (custom) return custom
  return path.join(os.homedir(), '.cloakbrowser')
}

function markerVersions(cacheDir: string): Set<string> {
  const versions = new Set<string>()
  let entries: string[]
  try {
    entries = fs.readdirSync(cacheDir)
  } catch {
    return versions
  }
  for (const name of entries) {
    if (!name.startsWith('latest_pro_version')) continue
    try {
      const version = fs.readFileSync(path.join(cacheDir, name), 'utf8').trim()
      if (version) versions.add(`chromium-${version}-pro`)
    } catch { /* unreadable marker */ }
  }
  return versions
}

function configuredBinaryDirectories(cacheDir: string): Set<string> {
  const protectedDirs = new Set<string>()
  const configuredPath = (process.env.CLOAKBROWSER_BINARY_PATH || '').trim()
  if (configuredPath) {
    const cacheRoots = new Set([path.resolve(cacheDir)])
    try { cacheRoots.add(fs.realpathSync(cacheDir)) } catch { /* cache may not exist yet */ }
    const binaryPaths = new Set([path.resolve(configuredPath)])
    try { binaryPaths.add(fs.realpathSync(configuredPath)) } catch { /* keep the configured path too */ }
    for (const root of cacheRoots) {
      for (const binaryPath of binaryPaths) {
        const relative = path.relative(root, binaryPath)
        if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) continue
        const [directory] = relative.split(path.sep)
        if (/^chromium-.+-pro$/.test(directory)) protectedDirs.add(directory)
      }
    }
  }
  const pinnedVersion = (process.env.CLOAKBROWSER_VERSION || '').trim()
  if (pinnedVersion && /^[\w.-]+$/.test(pinnedVersion)) {
    protectedDirs.add(`chromium-${pinnedVersion}-pro`)
  }
  return protectedDirs
}

function parsedVersion(name: string): bigint[] | undefined {
  const match = /^chromium-(.+)-pro$/.exec(name)
  if (!match) return undefined
  const parts = match[1].split('.')
  if (!parts.length || parts.some(part => !/^\d+$/.test(part))) return undefined
  return parts.map(part => BigInt(part))
}

function compareBinaryVersions(a: string, b: string): number | undefined {
  const aParts = parsedVersion(a)
  const bParts = parsedVersion(b)
  if (!aParts || !bParts) return undefined
  const length = Math.max(aParts.length, bParts.length)
  for (let index = 0; index < length; index++) {
    const difference = (aParts[index] ?? 0n) - (bParts[index] ?? 0n)
    if (difference < 0n) return -1
    if (difference > 0n) return 1
  }
  return 0
}

function launchableBinary(cacheDir: string, name: string): boolean {
  const directory = path.join(cacheDir, name)
  const executable = process.platform === 'win32'
    ? path.join(directory, 'chrome.exe')
    : process.platform === 'darwin'
      ? path.join(directory, 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      : path.join(directory, 'chrome')
  try {
    if (!fs.statSync(executable).isFile()) return false
    fs.accessSync(executable, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function pruneOldCloakBrowsers(cacheDir: string = cloakCacheDir(), keep = 1): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(cacheDir)
  } catch {
    return []
  }
  const usedVersions = markerVersions(cacheDir)
  const protectedDirs = new Set([...usedVersions, ...configuredBinaryDirectories(cacheDir)])
  const candidates = entries
    .filter((name) => /^chromium-.+-pro$/.test(name))
    .map((name) => {
      let mtimeMs = 0
      let isDirectory = false
      try {
        const stat = fs.lstatSync(path.join(cacheDir, name))
        mtimeMs = stat.mtimeMs
        isDirectory = stat.isDirectory()
      } catch { /* unreadable counts as oldest */ }
      return { name, mtimeMs, isDirectory, version: parsedVersion(name) }
    })
    .filter(({ name, isDirectory }) => isDirectory && launchableBinary(cacheDir, name))
  // The wrapper writes this marker after selecting a binary. Without one, a
  // newer cached directory could be an unfinished download or an unused build.
  if (!candidates.some(({ name }) => usedVersions.has(name))) return []
  const allVersionsKnown = candidates.every(({ version }) => version !== undefined)
  candidates.sort((a, b) => {
    if (!allVersionsKnown) return b.mtimeMs - a.mtimeMs
    const byVersion = compareBinaryVersions(a.name, b.name)!
    return -byVersion || b.mtimeMs - a.mtimeMs
  })
  const pruned: string[] = []
  candidates.forEach(({ name }, index) => {
    if (index < Math.max(keep, 0) || protectedDirs.has(name)) return
    try {
      fs.rmSync(path.join(cacheDir, name), { recursive: true, force: true })
      pruned.push(name)
    } catch (error) {
      process.stderr.write(`Could not prune old Cloak binary ${name}: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}\n`)
    }
  })
  return pruned
}
