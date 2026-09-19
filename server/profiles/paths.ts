import fs from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { resolveProjectRoot } from '../shared/utils.js'
import { ValidationError } from '../shared/errors.js'

const DATA_DIR = path.join(resolveProjectRoot(import.meta.url), 'data')
export const PROFILES_DIR = path.join(DATA_DIR, 'profiles')
const LOCKS_DIR = path.join(DATA_DIR, 'profile-locks')

export function validateProfileName(name: string): void {
  if (!name || name !== name.trim() || name === '.' || name === '..' ||
      /[\\/\x00<>:"|?*]/.test(name) || /[. ]$/.test(name) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
    throw new ValidationError('Invalid profile name')
  }
}

export function profileDirectory(name: string): string {
  validateProfileName(name)
  const root = path.resolve(PROFILES_DIR)
  const target = path.resolve(root, name)
  if (path.dirname(target) !== root) throw new ValidationError('Invalid profile path')
  return target
}

/** SQLite's OS-backed writer lock is exclusive across workers and released on exit.
 * Keep the backing files: unlinking a locked file would allow a second lock inode. */
export function lockProfile(name: string): () => void {
  validateProfileName(name)
  const root = LOCKS_DIR
  fs.mkdirSync(root, { recursive: true })
  const db = new Database(path.join(root, `${name.toLowerCase()}.sqlite`), { create: true })
  try {
    db.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE')
  } catch (error) {
    db.close()
    if ((error as { code?: string }).code === 'SQLITE_BUSY')
      throw new Error(`Profile is already open: ${name}`)
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try { db.exec('ROLLBACK') } finally { db.close() }
  }
}
