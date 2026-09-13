import type { ProfileRecord } from '../shared/contracts.js'
import fs from 'fs'
import path from 'path'
import {
  profilesCreate,
  profilesDeleteByName,
  profilesGetById,
  profilesList,
  profilesSyncStatus,
  profilesUpdateByName,
} from '../shared/convexClient.js'
import logger from '../shared/logger.js'
import { resolveProjectRoot } from '../shared/utils.js'
import { automationMutex } from '../shared/mutex.js'
import { getTrackedProcesses } from '../shared/ProcessService.js'
import { profileProcesses, workflowWorkers } from '../shared/store.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const PROFILES_DIR = path.join(PROJECT_ROOT, 'data', 'profiles')

export type Profile = {
  id?: string
  name: string
  proxy?: string
  proxyType?: string
  fingerprintOs?: string
  cookiesJson?: string
  testIp?: boolean
  status?: string
  using?: boolean
  login?: boolean
  listIds?: string[]
  dailyScrapingLimit?: number | null
  assignedAccountsLimit?: number | null
  dailyScrapingUsed?: number
}

function mapDbRowToProfile(
  { cookiesJson: _cookies, sessionId: _sessionId, ...profile }: ProfileRecord,
): Profile {
  return profile
}

function mapDbRowToProfileWithCookies(profile: ProfileRecord | null): Profile | null {
  if (!profile) return null
  const { sessionId: _sessionId, ...safeProfile } = profile
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
        testIp: profile.testIp,
        dailyScrapingLimit: profile.dailyScrapingLimit,
        assignedAccountsLimit: profile.assignedAccountsLimit,
      })
    } catch (e) {
      logger.error({ err: e }, 'Error creating profile in DB')
      return false
    }

    if (!fs.existsSync(PROFILES_DIR)) {
      fs.mkdirSync(PROFILES_DIR, { recursive: true })
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
        testIp: profile.testIp,
        dailyScrapingLimit: profile.dailyScrapingLimit,
        assignedAccountsLimit: profile.assignedAccountsLimit,
      })
    } catch (e) {
      logger.error({ err: e }, 'Error updating profile in DB')
      return false
    }

    if (oldName !== profile.name) {
      const oldPath = path.join(PROFILES_DIR, oldName)
      const newPath = path.join(PROFILES_DIR, profile.name)
      if (fs.existsSync(oldPath)) {
        try {
          fs.renameSync(oldPath, newPath)
        } catch (e) {
          logger.error({ err: e }, 'Error renaming profile directory')
        }
      }
    }

    return true
  }

  async deleteProfile(name: string): Promise<boolean> {
    try {
      await profilesDeleteByName(name)
    } catch (e) {
      logger.error({ err: e }, 'Error deleting profile from DB')
      return false
    }

    // Only touch browser data after a confirmed DB delete.
    this.removeLocalProfileDir(name)

    return true
  }

  /**
   * Recovery helper for orphan profile directories left behind by older
   * deletes (e.g. direct DB removes that bypassed the backend). Deliberately
   * separate from deleteProfile so a failed DB delete can never wipe a live
   * profile's cookies and fingerprint cache.
   */
  removeLocalProfileDir(name: string): boolean {
    const clean = String(name || '').trim()
    if (!clean || clean === '.' || clean === '..' || /[/\\]/.test(clean)) return false
    const profilePath = path.join(PROFILES_DIR, clean)
    if (!fs.existsSync(profilePath)) return false
    try {
      fs.rmSync(profilePath, { recursive: true, force: true })
      return true
    } catch (e) {
      logger.error({ err: e }, 'Error deleting profile directory')
      return false
    }
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
      if (getTrackedProcesses().size || profileProcesses.size || workflowWorkers.size) {
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
