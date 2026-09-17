import { Router } from 'express'
import crypto from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { asyncHandler } from '../shared/asyncHandler.js'
import { NotFoundError, ValidationError } from '../shared/errors.js'
import {
  GENERAL_UPLOADS_DIR,
  PROFILE_UPLOADS_ROOT,
  ensureUploadDirs,
  resolveUploadsRootDir,
  resolveUploadsRoots,
} from './uploads.js'

const MAX_BYTES = 500 * 1024 * 1024
const MAX_NAME_LENGTH = 255
const STALE_UPLOAD_AGE_MS = 60 * 60 * 1000

// Resolve a client-supplied relative path strictly inside rootDir
// (lexical check — callers additionally verify the real path below).
function resolveInside(rootDir: string, relPath: unknown): string {
  const rel = String(relPath || '')
  if (rel.includes('\0')) throw new ValidationError('Invalid path')
  const resolved = path.resolve(rootDir, '.' + path.sep + rel)
  const base = path.resolve(rootDir)
  if (resolved !== base && !resolved.startsWith(base + path.sep))
    throw new ValidationError('Invalid path')
  return resolved
}

// Names that identify an existing entry are preserved exactly. Only
// separators, NUL bytes and dot-names are rejected — files already on
// disk may contain any other characters, and silently rewriting a name
// could address (and delete) a different file than the caller named.
function validateExistingName(raw: unknown): string {
  const name = String(raw || '')
  if (!name) throw new ValidationError('Name is required')
  if (name.includes('\0') || name.includes('/') || name.includes('\\'))
    throw new ValidationError('Invalid name')
  if (name === '.' || name === '..') throw new ValidationError('Invalid name')
  if (name.length > MAX_NAME_LENGTH) throw new ValidationError('Name too long')
  if (path.basename(name) !== name) throw new ValidationError('Invalid name')
  return name
}

// Names for new entries (mkdir, rename target, upload filename) must
// additionally fit the Finder-friendly allowlist. Rejected — never
// rewritten — so a request can never land on a different name.
const NEW_NAME_PATTERN = /^[a-zA-Z0-9._\- ()[\]]+$/

function validateNewName(raw: unknown): string {
  const name = String(raw || '').trim()
  if (!name) throw new ValidationError('Name is required')
  if (name === '.' || name === '..') throw new ValidationError('Invalid name')
  if (name.length > MAX_NAME_LENGTH) throw new ValidationError('Name too long')
  if (!NEW_NAME_PATTERN.test(name))
    throw new ValidationError('Name contains unsupported characters')
  return name
}

// Symlink containment: stat/readdir/download follow links, so the
// lexical check in resolveInside is not enough. Every existing path is
// resolved to its real location and verified against the real root.
function assertWithinRoot(realRoot: string, realPath: string): void {
  if (realPath !== realRoot && !realPath.startsWith(realRoot + path.sep))
    throw new ValidationError('Invalid path')
}

async function realpathExisting(target: string, notFoundMessage: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch {
    throw new NotFoundError(notFoundMessage)
  }
}

// Resolve the request target dir: lexical containment first, then the
// real (symlink-resolved) directory verified inside the real root.
async function resolveTargetDir(rootDir: string, relPath: unknown): Promise<string> {
  const realRoot = await fs.realpath(rootDir)
  const dir = resolveInside(rootDir, relPath)
  const realDir = await realpathExisting(dir, 'Folder not found')
  assertWithinRoot(realRoot, realDir)
  const stat = await fs.stat(realDir)
  if (!stat.isDirectory()) throw new ValidationError('Not a folder')
  return realDir
}

function kindFor(name: string, isDir: boolean): string {
  if (isDir) return 'Folder'
  const ext = path.extname(name).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif'].includes(ext)) return 'Image'
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return 'Video'
  if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) return 'Audio'
  if (['.pdf'].includes(ext)) return 'PDF'
  if (['.zip', '.tar', '.gz', '.rar', '.7z'].includes(ext)) return 'Archive'
  if (['.txt', '.md', '.json', '.csv', '.log', '.ts', '.tsx', '.js'].includes(ext)) return 'Text'
  if (!ext) return 'File'
  return `${ext.slice(1).toUpperCase()} file`
}

// Remove crashed-upload leftovers from a previous partial request.
async function cleanupStaleUploads(dir: string): Promise<void> {
  try {
    const names = await fs.readdir(dir)
    const cutoff = Date.now() - STALE_UPLOAD_AGE_MS
    await Promise.all(
      names
        .filter((n) => n.startsWith('.upload-') && n.endsWith('.tmp'))
        .map(async (n) => {
          const full = path.join(dir, n)
          try {
            const stat = await fs.stat(full)
            if (stat.isFile() && stat.mtimeMs < cutoff) await fs.unlink(full)
          } catch {
            // Best effort only.
          }
        }),
    )
  } catch {
    // Best effort only.
  }
}

const router = Router()

router.get(
  '/roots',
  asyncHandler(async (_req, res) => {
    await ensureUploadDirs()
    res.json(
      resolveUploadsRoots().map((r) => ({ id: r.id, label: r.label, kind: r.kind })),
    )
  }),
)

router.get(
  '/list',
  asyncHandler(async (req, res) => {
    await ensureUploadDirs()
    const root = await resolveUploadsRootDir(req.query.root)
    const realRoot = await fs.realpath(root.dir)
    const realDir = await resolveTargetDir(root.dir, req.query.path)
    const names = await fs.readdir(realDir)
    const entries = (
      await Promise.all(
        names.map(async (name) => {
          try {
            const full = path.join(realDir, name)
            const realFull = await fs.realpath(full)
            // Never leak entries that resolve outside the root.
            if (realFull !== realRoot && !realFull.startsWith(realRoot + path.sep))
              return null
            const st = await fs.stat(realFull)
            return {
              name,
              isDir: st.isDirectory(),
              size: st.isDirectory() ? 0 : st.size,
              mtime: st.mtimeMs,
              kind: kindFor(name, st.isDirectory()),
            }
          } catch {
            return null
          }
        }),
      )
    )
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    const rel = path.relative(realRoot, realDir) || '.'
    res.json({ root: root.id, path: rel === '.' ? '' : rel, entries })
  }),
)

router.get(
  '/usage',
  asyncHandler(async (_req, res) => {
    await ensureUploadDirs()
    // Disk stats for the volume holding ./data.
    let total = 0
    let free = 0
    try {
      const s = await fs.statfs(GENERAL_UPLOADS_DIR)
      total = s.blocks * s.bsize
      free = s.bfree * s.bsize
    } catch {
      total = 0
      free = 0
    }
    // Uploads footprint: top-level files in General + each profile folder.
    let uploadsCount = 0
    let uploadsBytes = 0
    try {
      const folders = [GENERAL_UPLOADS_DIR]
      try {
        const profiles = await fs.readdir(PROFILE_UPLOADS_ROOT, { withFileTypes: true })
        for (const entry of profiles) {
          if (entry.isDirectory()) folders.push(path.join(PROFILE_UPLOADS_ROOT, entry.name))
        }
      } catch {
        // Profiles folder missing — General below still counts.
      }
      for (const folder of folders) {
        let names: string[] = []
        try {
          names = await fs.readdir(folder)
        } catch {
          continue
        }
        for (const name of names) {
          try {
            const st = await fs.stat(path.join(folder, name))
            if (st.isFile()) {
              uploadsCount += 1
              uploadsBytes += st.size
            }
          } catch {
            // Gone mid-read — skip.
          }
        }
      }
    } catch {
      uploadsCount = 0
      uploadsBytes = 0
    }
    const used = total > 0 ? Math.max(0, total - free) : 0
    res.json({
      total,
      free,
      used,
      usedPercent: total > 0 ? Math.round((used / total) * 100) : 0,
      uploadsCount,
      uploadsBytes,
    })
  }),
)

router.post(
  '/mkdir',
  asyncHandler(async (req, res) => {
    await ensureUploadDirs()
    const body = (req.body || {}) as { root?: unknown; path?: unknown; name?: unknown }
    const root = await resolveUploadsRootDir(body.root)
    const realDir = await resolveTargetDir(root.dir, body.path)
    const name = validateNewName(body.name)
    try {
      await fs.mkdir(path.join(realDir, name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new ValidationError('A file or folder with that name exists')
      throw error
    }
    res.json({ success: true, name })
  }),
)

router.post(
  '/rename',
  asyncHandler(async (req, res) => {
    await ensureUploadDirs()
    const body = (req.body || {}) as {
      root?: unknown
      path?: unknown
      from?: unknown
      to?: unknown
    }
    const root = await resolveUploadsRootDir(body.root)
    const realRoot = await fs.realpath(root.dir)
    const realDir = await resolveTargetDir(root.dir, body.path)
    const from = validateExistingName(body.from)
    const to = validateNewName(body.to)
    if (from === to) throw new ValidationError('Pick a different name')
    const realSrc = await realpathExisting(path.join(realDir, from), 'File not found')
    assertWithinRoot(realRoot, realSrc)
    const dst = path.join(realDir, to)
    try {
      await fs.lstat(dst)
      throw new ValidationError('A file or folder with that name exists')
    } catch (error) {
      if (error instanceof ValidationError) throw error
      // dst missing — proceed.
    }
    await fs.rename(realSrc, dst)
    res.json({ success: true, name: to })
  }),
)

router.delete(
  '/',
  asyncHandler(async (req, res) => {
    await ensureUploadDirs()
    const root = await resolveUploadsRootDir(req.query.root)
    const realRoot = await fs.realpath(root.dir)
    const realDir = await resolveTargetDir(root.dir, req.query.path)
    const name = validateExistingName(req.query.name)
    const full = path.join(realDir, name)
    const realFull = await realpathExisting(full, 'File not found')
    assertWithinRoot(realRoot, realFull)
    // rm() removes a trailing symlink itself rather than its target,
    // and the realpath check above already confined the target.
    await fs.rm(full, { recursive: true, force: false })
    res.json({ success: true })
  }),
)

// Streaming upload into the current folder. Any file type, 500 MB cap.
// The body is piped straight to a temp file — never buffered in memory —
// with the byte limit enforced while streaming. The final name is then
// claimed with link(), which fails EEXIST atomically, so concurrent
// uploads with the same filename can never overwrite each other.
// Frontend sends File bytes with Content-Type + X-Filename headers.
router.post(
  '/upload',
  asyncHandler(async (req, res) => {
    await ensureUploadDirs()
    const root = await resolveUploadsRootDir(req.query.root)
    const realDir = await resolveTargetDir(root.dir, req.query.path)

    const contentLength = Number(req.headers['content-length'])
    if (Number.isFinite(contentLength)) {
      if (contentLength <= 0) throw new ValidationError('Empty file')
      if (contentLength > MAX_BYTES)
        throw new ValidationError('File too large (max 500 MB)')
    }

    const clean = validateNewName(req.headers['x-filename'])

    await cleanupStaleUploads(realDir)
    const tmpName = `.upload-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.tmp`
    const tmpPath = path.join(realDir, tmpName)

    let received = 0
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > MAX_BYTES)
          callback(new ValidationError('File too large (max 500 MB)'))
        else callback(null, chunk)
      },
    })

    try {
      await pipeline(req, limiter, createWriteStream(tmpPath, { flags: 'wx' }))
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined)
      throw error
    }
    if (received === 0) {
      await fs.unlink(tmpPath).catch(() => undefined)
      throw new ValidationError('Empty file')
    }

    const ext = path.extname(clean)
    const stem = path.basename(clean, ext) || 'file'
    for (let i = 0; i < 1000; i += 1) {
      const candidate = i === 0 ? clean : `${stem} (${i})${ext}`
      const finalPath = path.join(realDir, candidate)
      try {
        await fs.link(tmpPath, finalPath)
        await fs.unlink(tmpPath).catch(() => undefined)
        return res.json({ success: true, filename: candidate, size: received })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        await fs.unlink(tmpPath).catch(() => undefined)
        throw error
      }
    }
    await fs.unlink(tmpPath).catch(() => undefined)
    throw new ValidationError('Name conflict — pick another name')
  }),
)

router.get(
  '/download',
  asyncHandler(async (req, res) => {
    await ensureUploadDirs()
    const root = await resolveUploadsRootDir(req.query.root)
    const realRoot = await fs.realpath(root.dir)
    const realDir = await resolveTargetDir(root.dir, req.query.path)
    const name = validateExistingName(req.query.name)
    const realFull = await realpathExisting(path.join(realDir, name), 'File not found')
    assertWithinRoot(realRoot, realFull)
    const st = await fs.stat(realFull)
    if (!st.isFile()) throw new ValidationError('Not a file')
    res.download(realFull, name)
  }),
)

export default router
