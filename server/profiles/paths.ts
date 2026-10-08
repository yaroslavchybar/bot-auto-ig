import path from 'node:path'
import { nativeLease } from '../shared/runtimeSockets.js'
import { resolveProjectRoot } from '../shared/utils.js'
import { ValidationError } from '../shared/errors.js'

const DATA_DIR = path.join(resolveProjectRoot(import.meta.url), 'data')
export const PROFILES_DIR = path.join(DATA_DIR, 'profiles')

export function validateProfileName(name: string): void {
  if (
    !name ||
    name !== name.trim() ||
    name === '.' ||
    name === '..' ||
    name.includes('\0') ||
    /[\\/<>:"|?*]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)
  ) {
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

/** Rust holds the OS lock until browser cleanup releases this socket. */
export async function acquireProfileLock(
  name: string,
  signal: AbortSignal,
  onLost: () => void,
): Promise<() => void> {
  validateProfileName(name)
  const lease = await nativeLease('/profiles/lease', { profileName: name }, signal, onLost)
  return lease.release
}
