import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ValidationError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
export const UPLOADS_ROOT = path.join(PROJECT_ROOT, 'data', 'uploads')

// Shared folder, visible to every profile in the Files tab.
export const GENERAL_DIR_NAME = 'general'
export const GENERAL_UPLOADS_DIR = path.join(UPLOADS_ROOT, GENERAL_DIR_NAME)

// One folder per profile lives under here: profiles/<profileName>/.
// A single "Profile Uploads" root keeps every profile's files visible in
// one place, while each remote browser only ever sees its own subfolder.
export const PROFILES_DIR_NAME = 'profiles'
export const PROFILE_UPLOADS_ROOT = path.join(UPLOADS_ROOT, PROFILES_DIR_NAME)

export type UploadsRootKind = 'general' | 'profiles'

export type UploadsRoot = {
  id: string
  label: string
  kind: UploadsRootKind
  dir: string
}

// A profile name is safe as a directory segment when it carries no
// separators and isn't a dot-name (mirrors the browser profile guard).
export function isSafeSegment(name: string): boolean {
  const clean = String(name || '').trim()
  if (!clean || clean === '.' || clean === '..') return false
  if (clean.length > 255) return false
  if (clean.includes('/') || clean.includes('\\') || clean.includes('\0')) return false
  return true
}

export function resolveUploadsRoots(): UploadsRoot[] {
  return [
    { id: 'general', label: 'General Uploads', kind: 'general', dir: GENERAL_UPLOADS_DIR },
    { id: 'profiles', label: 'Profile Uploads', kind: 'profiles', dir: PROFILE_UPLOADS_ROOT },
  ]
}

// Map a root id from the client to its directory.
export async function resolveUploadsRootDir(rootId: unknown): Promise<UploadsRoot> {
  const id = String(rootId || '')
  const root = resolveUploadsRoots().find((r) => r.id === id)
  if (!root) throw new ValidationError('Invalid root')
  await fs.mkdir(root.dir, { recursive: true })
  return root
}

// Directory holding one profile's files (created on demand).
export async function ensureProfileUploadsDir(profileName: string): Promise<string> {
  const dir = profileUploadsDir(profileName)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export function profileUploadsDir(profileName: string): string {
  const clean = String(profileName || '').trim()
  if (!isSafeSegment(clean)) throw new ValidationError('Invalid profile name')
  return path.join(PROFILE_UPLOADS_ROOT, clean)
}

async function uniqueLink(src: string, dir: string, name: string): Promise<boolean> {
  const ext = path.extname(name)
  const stem = path.basename(name, ext) || 'file'
  for (let i = 0; i < 1000; i += 1) {
    const candidate = i === 0 ? name : `${stem} (${i})${ext}`
    try {
      await fs.link(src, path.join(dir, candidate))
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      return false
    }
  }
  return false
}

// One-time move from the flat layout: loose files go to General, stray
// folders join the per-profile folders, so everything stays visible.
async function migrateLooseEntries(): Promise<void> {
  try {
    const entries = await fs.readdir(UPLOADS_ROOT, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === GENERAL_DIR_NAME || entry.name === PROFILES_DIR_NAME) continue
      if (entry.name.startsWith('.')) continue
      const src = path.join(UPLOADS_ROOT, entry.name)
      try {
        if (entry.isFile()) {
          if (entry.name.startsWith('.upload-') && entry.name.endsWith('.tmp')) continue
          if (await uniqueLink(src, GENERAL_UPLOADS_DIR, entry.name)) await fs.unlink(src)
        } else if (entry.isDirectory() && isSafeSegment(entry.name)) {
          const dst = path.join(PROFILE_UPLOADS_ROOT, entry.name)
          try {
            await fs.lstat(dst)
          } catch {
            await fs.rename(src, dst)
          }
        }
      } catch {
        // Best effort per entry — the next request retries leftovers.
      }
    }
  } catch {
    // Best effort only.
  }
}

// Keep ~/Downloads/Uploads pointing at the uploads root so the remote
// GTK file dialog still offers a shared entry point. Moved here from
// the retired displays/uploads router.
async function ensureDownloadsSymlink(): Promise<void> {
  if (process.platform !== 'linux') return
  try {
    const downloads = path.join(os.homedir(), 'Downloads')
    await fs.mkdir(downloads, { recursive: true })
    const link = path.join(downloads, 'Uploads')
    try {
      const stat = await fs.lstat(link)
      if (stat.isSymbolicLink()) {
        if ((await fs.readlink(link)) === UPLOADS_ROOT) return
        await fs.unlink(link)
      } else {
        // Real dir/file already there — don't clobber it.
        return
      }
    } catch {
      // No link yet — create it below.
    }
    await fs.symlink(UPLOADS_ROOT, link)
  } catch {
    // Best effort only.
  }
}

export async function ensureUploadDirs(): Promise<void> {
  await fs.mkdir(UPLOADS_ROOT, { recursive: true })
  await fs.mkdir(GENERAL_UPLOADS_DIR, { recursive: true })
  await fs.mkdir(PROFILE_UPLOADS_ROOT, { recursive: true })
  await migrateLooseEntries()
  await ensureDownloadsSymlink()
}
