import type { ProfileRecord } from '../shared/contracts.js'
import fs from 'fs'
import path from 'path'
import {
  profilesCreate,
  profilesFinishDelete,
  profilesFinishRename,
  profilesGetById,
  profilesList,
  profilesSyncStatus,
  profilesUpdateByName,
} from '../shared/convexClient.js'
import logger from '../shared/logger.js'
import { PROFILES_DIR, profileDirectory } from './paths.js'
import { automationMutex } from '../shared/mutex.js'
import { getTrackedProcesses } from '../shared/ProcessService.js'
import { profileProcesses, automationWorkers } from '../shared/store.js'
import { PROFILE_UPLOADS_ROOT, ensureProfileUploadsDir, profileUploadsDir } from '../files/uploads.js'

async function removeProfileData(root: string, target: string): Promise<void> {
  if (path.dirname(path.resolve(target)) !== path.resolve(root)) throw new Error('Invalid profile directory')
  try {
    if (await fs.promises.realpath(root) !== path.resolve(root)) throw new Error('Profile root is redirected')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

export type Profile = {
  renameFrom?: string
  id?: string
  name: string
  proxy?: string
  proxyType?: string
  fingerprintOs?: string
  cookiesJson?: string
  status?: string
  using?: boolean
  listIds?: string[]
}

// Stored rows may predate field removals, so tolerate legacy extra fields
// at this boundary and strip them before returning API-facing profiles.
type StoredProfileRow = ProfileRecord & {
  sessionId?: unknown
  login?: unknown
  testIp?: unknown
}

function mapDbRowToProfile(
  { cookiesJson: _cookies, sessionId: _sessionId, login: _login, testIp: _testIp, ...profile }: StoredProfileRow,
): Profile {
  return profile
}

function mapDbRowToProfileWithCookies(profile: StoredProfileRow | null): Profile | null {
  if (!profile) return null
  const { sessionId: _sessionId, login: _login, testIp: _testIp, ...safeProfile } = profile
  return safeProfile
}

export class ProfileManager {
  async getProfiles(): Promise<Profile[]> {
    try {
      const data = await profilesList()
      return (data || []).map(mapDbRowToProfile)
    } catch (e) {
      logger.error({ err: e }, 'Error fetching profiles')
      return []
    }
  }

  async getProfileById(profileId: string): Promise<Profile | null> {
    try {
      const row = await profilesGetById(profileId)
      return mapDbRowToProfileWithCookies(row)
    } catch (e) {
      logger.error({ err: e }, 'Error fetching profile by id')
      return null
    }
  }

  async createProfile(profile: Profile): Promise<boolean> {
    try {
      await profilesCreate({
        name: profile.name,
        proxy: profile.proxy,
        proxyType: profile.proxyType,
        fingerprintOs: profile.fingerprintOs,
        cookiesJson: profile.cookiesJson,
      })
    } catch (e) {
      logger.error({ err: e }, 'Error creating profile in DB')
      return false
    }

    if (!fs.existsSync(PROFILES_DIR)) {
      fs.mkdirSync(PROFILES_DIR, { recursive: true })
    }

    // Its uploads folder shows up in the Files tab right away.
    try {
      await ensureProfileUploadsDir(profile.name)
    } catch (e) {
      logger.error({ err: e }, 'Error creating profile uploads directory')
    }

    return true
  }

  async updateProfile(oldName: string, profile: Profile): Promise<boolean> {
    try {
      await profilesUpdateByName(oldName, {
        name: profile.name,
        proxy: profile.proxy,
        proxyType: profile.proxyType,
        fingerprintOs: profile.fingerprintOs,
        cookiesJson: profile.cookiesJson,
      })
    } catch (e) {
      logger.error({ err: e }, 'Error updating profile in DB')
      return false
    }

    return true
  }

  /** Called with all affected profile locks held. Retry-safe after partial cleanup. */
  async finishDeletion(profile: Profile): Promise<void> {
    if (!profile.id || profile.status !== 'deleting') throw new Error('Profile is not pending deletion')
    for (const name of new Set([profile.name, ...(profile.renameFrom ? [profile.renameFrom] : [])])) {
      await removeProfileData(PROFILES_DIR, profileDirectory(name))
      await removeProfileData(PROFILE_UPLOADS_ROOT, profileUploadsDir(name))
    }
    await profilesFinishDelete(profile.id)
  }

  /** Keep renameFrom until both directory moves succeed, including across restarts. */
  async finishRename(profile: Profile): Promise<void> {
    if (!profile.renameFrom || !profile.id) return
    for (const [oldPath, newPath] of [
      [profileDirectory(profile.renameFrom), profileDirectory(profile.name)],
      [profileUploadsDir(profile.renameFrom), profileUploadsDir(profile.name)],
    ]) {
      try { await fs.promises.lstat(oldPath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      try {
        await fs.promises.lstat(newPath)
        if (oldPath.toLowerCase() !== newPath.toLowerCase()) throw new Error('Rename destination already exists')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await fs.promises.rename(oldPath, newPath)
    }
    await profilesFinishRename(profile.id)
  }

  async syncProfileStatus(name: string, status: string, using: boolean): Promise<boolean> {
    try {
      await profilesSyncStatus(name, status, using)
      return true
    } catch (e) {
      logger.error({ err: e }, 'Error syncing profile status')
      return false
    }
  }

  /**
   * Reconcile DB "running/using" flags with actual in-memory runtime state.
   * Any busy profile that has no active process is reset to idle.
   */
  async reconcileRuntimeStatuses(
    activeProfileNames: Iterable<string>,
  ): Promise<{ cleared: number; errors: string[] }> {
    const release = await automationMutex.acquire()
    try {
      // A live worker may be starting a profile before its first status event arrives.
      if (getTrackedProcesses().size || profileProcesses.size || automationWorkers.size) {
        return { cleared: 0, errors: [] }
      }
      return await this.reconcileIdleRuntimeStatuses(activeProfileNames)
    } finally {
      release()
    }
  }

  private async reconcileIdleRuntimeStatuses(
    activeProfileNames: Iterable<string>,
  ): Promise<{ cleared: number; errors: string[] }> {
    const active = new Set(
      Array.from(activeProfileNames || [])
        .map((name) => String(name || '').trim())
        .filter(Boolean),
    )

    let profiles: Profile[] = []
    try {
      profiles = await this.getProfiles()
    } catch (e: any) {
      const msg = `Failed to load profiles for runtime reconciliation: ${e?.message || e}`
      logger.error({ err: e }, msg)
      return { cleared: 0, errors: [msg] }
    }

    const stale = profiles.filter((p) => {
      const name = String(p.name || '').trim()
      if (!name) return false
      const status = String(p.status || '').trim().toLowerCase()
      const isBusy = Boolean(p.using) || status === 'running'
      return isBusy && !active.has(name)
    })

    if (stale.length === 0) return { cleared: 0, errors: [] }

    let cleared = 0
    const errors: string[] = []

    for (const profile of stale) {
      try {
        await profilesSyncStatus(profile.name, 'idle', false)
        cleared++
      } catch (e: any) {
        const msg = `Failed to clear stale status for profile "${profile.name}": ${e?.message || e}`
        logger.error({ err: e, profile: profile.name }, msg)
        errors.push(msg)
      }
    }

    return { cleared, errors }
  }
}

export const profileManager = new ProfileManager()
