import { Router } from 'express'
import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { asyncHandler } from '../shared/asyncHandler.js'
import { ValidationError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'data', 'uploads')

const MAX_BYTES = 500 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

// Uploads land in data/uploads (persisted via ./data volume).
// On Linux also expose them under ~/Downloads/Uploads so the remote
// GTK file dialog shows them in one click under Downloads.
async function ensureDirs(): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  if (process.platform !== 'linux') return
  try {
    const downloads = path.join(os.homedir(), 'Downloads')
    await fs.mkdir(downloads, { recursive: true })
    const link = path.join(downloads, 'Uploads')
    try {
      const stat = await fs.lstat(link)
      if (stat.isSymbolicLink()) {
        if ((await fs.readlink(link)) === UPLOAD_DIR) return
        await fs.unlink(link)
      } else {
        // Real dir/file already there — don't clobber, just copy files in.
        return
      }
    } catch {
      // No link yet — create it below.
    }
    await fs.symlink(UPLOAD_DIR, link)
  } catch {
    // Best effort only — uploads still work via /app/data/uploads.
  }
}

function sanitizeFilename(raw: string): string {
  const base = path.basename(String(raw || '')).trim()
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  if (!clean) throw new ValidationError('Filename is required (X-Filename header)')
  const ext = path.extname(clean).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) throw new ValidationError('Only jpg, png, webp allowed')
  return clean
}

const router = Router()

// List recent uploads so the UI can confirm "ready, now pick it remotely".
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    await ensureDirs()
    let entries: { name: string; size: number; mtime: number }[] = []
    try {
      const names = await fs.readdir(UPLOAD_DIR)
      const stats = await Promise.all(
        names.map(async (name) => {
          try {
            const stat = await fs.stat(path.join(UPLOAD_DIR, name))
            if (!stat.isFile()) return null
            return { name, size: stat.size, mtime: stat.mtimeMs }
          } catch {
            return null
          }
        }),
      )
      entries = stats
        .filter((e): e is { name: string; size: number; mtime: number } => e !== null)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 20)
    } catch {
      entries = []
    }
    res.json(entries)
  }),
)

// Raw bytes upload — no extra dep. Frontend sends File bytes with
// Content-Type + X-Filename headers. express.raw enforces the size limit
// while buffering; the buffer is written once, and the Downloads mirror
// (when it's a real dir, not our symlink) is a copyFile so the payload
// is never held twice in memory.
router.post(
  '/',
  express.raw({ type: '*/*', limit: MAX_BYTES }),
  asyncHandler(async (req, res) => {
    await ensureDirs()
    const body = req.body as Buffer | undefined
    if (!body || !(body instanceof Buffer) || body.length === 0)
      throw new ValidationError('Empty file')
    if (body.length > MAX_BYTES) throw new ValidationError('File too large (max 500 MB)')

    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_MIME.has(mime)) throw new ValidationError('Only jpg, png, webp allowed')

    const clean = sanitizeFilename(String(req.headers['x-filename'] || ''))
    const prefix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const filename = `${prefix}-${clean}`
    const saved = path.join(UPLOAD_DIR, filename)
    await fs.writeFile(saved, body)

    // If ~/Downloads/Uploads is a real dir (not our symlink), mirror the file
    // so it still shows up under Downloads in the GTK dialog.
    if (process.platform === 'linux') {
      try {
        const mirror = path.join(os.homedir(), 'Downloads', 'Uploads')
        const stat = await fs.lstat(mirror)
        if (!stat.isSymbolicLink() && stat.isDirectory()) {
          await fs.copyFile(saved, path.join(mirror, filename))
        }
      } catch {
        // Symlink case already covers it — nothing to do.
      }
    }

    res.json({ success: true, filename, size: body.length })
  }),
)

export default router
