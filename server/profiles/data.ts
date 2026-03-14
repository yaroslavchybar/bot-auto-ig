import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  profilesCreate,
  profilesDeleteByName,
  profilesGetById,
  profilesList,
  profilesSyncStatus,
  profilesUpdateByName,
} from '../data/convex.js'
import logger from '../shared/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PROFILES_DIR = path.join(PROJECT_ROOT, 'data', 'profiles')

export type Profile = {
  id?: string
  name: string
  proxy?: string
  proxy_type?: string
  fingerprint_seed?: string
  fingerprint_os?: string
  cookies_json?: string
  test_ip?: boolean
  status?: string
  using?: boolean
  login?: boolean
  list_ids?: string[]
  daily_scraping_limit?: number | null
  daily_scraping_used?: number
}

function mapDbRowToProfile(p: any): Profile {
  return {
    id: p.profile_id,
    name: p.name,
    proxy: p.proxy,
    proxy_type: p.proxy_type,
    fingerprint_seed: p.fingerprint_seed,
    fingerprint_os: p.fingerprint_os,
    cookies_json: undefined,
    test_ip: p.test_ip,
    status: p.status,
    using: p.Using,
    login: p.login,
    list_ids: Array.isArray(p.list_ids)
      ? p.list_ids.map((id: unknown) => String(id || '')).filter(Boolean)
      : [],
    daily_scraping_limit:
      typeof p.daily_scraping_limit === 'number' ? p.daily_scraping_limit : null,
    daily_scraping_used:
      typeof p.daily_scraping_used === 'number' ? p.daily_scraping_used : 0,
  }
}

function mapDbRowToProfileWithCookies(row: any): Profile | null {
  if (!row) return null
  return {
    id: row.profile_id,
    name: row.name,
    proxy: row.proxy ?? undefined,
    proxy_type: row.proxy_type ?? undefined,
    fingerprint_seed: row.fingerprint_seed ?? undefined,
    fingerprint_os: row.fingerprint_os ?? undefined,
    cookies_json: row.cookies_json ?? undefined,
    test_ip: row.test_ip,
    status: row.status ?? undefined,
    using: row.Using,
    login: row.login,
    list_ids: Array.isArray(row.list_ids)
      ? row.list_ids.map((id: unknown) => String(id || '')).filter(Boolean)
      : [],
    daily_scraping_limit:
      typeof row.daily_scraping_limit === 'number' ? row.daily_scraping_limit : null,
    daily_scraping_used:
      typeof row.daily_scraping_used === 'number' ? row.daily_scraping_used : 0,
  }
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

  /** Get profile folder names from local data/profiles directory */
  getLocalProfileNames(): string[] {
    try {
      if (!fs.existsSync(PROFILES_DIR)) return []
      return fs
        .readdirSync(PROFILES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch (e) {
      logger.error({ err: e }, 'Error reading local profiles')
      return []
    }
  }

  /** Sync local profiles to database — creates DB entries for local profiles that don't exist in DB */
  async syncLocalProfilesToDb(): Promise<{ created: number; errors: string[] }> {
    const localNames = this.getLocalProfileNames()
    if (localNames.length === 0) return { created: 0, errors: [] }

    let dbProfiles: Profile[] = []
    try {
      dbProfiles = await this.getProfiles()
    } catch {
      dbProfiles = []
    }

    const dbNames = new Set(dbProfiles.map((p) => p.name))
    const toCreate = localNames.filter((name) => !dbNames.has(name))

    let created = 0
    const errors: string[] = []

    for (const name of toCreate) {
      try {
        await profilesCreate({ name, test_ip: false })
        created++
        logger.info({ profile: name }, 'Auto-created profile in DB')
      } catch (e: any) {
        const msg = `Failed to create profile "${name}": ${e?.message || e}`
        logger.error({ err: e, profile: name }, msg)
        errors.push(msg)
      }
    }

    return { created, errors }
  }

  async createProfile(profile: Profile): Promise<boolean> {
    try {
      await profilesCreate({
        name: profile.name,
        proxy: profile.proxy,
        proxy_type: profile.proxy_type,
        fingerprint_seed: profile.fingerprint_seed,
        fingerprint_os: profile.fingerprint_os,
        cookies_json: profile.cookies_json,
        test_ip: profile.test_ip,
        daily_scraping_limit: profile.daily_scraping_limit,
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
        proxy_type: profile.proxy_type,
        fingerprint_seed: profile.fingerprint_seed,
        fingerprint_os: profile.fingerprint_os,
        cookies_json: profile.cookies_json,
        test_ip: profile.test_ip,
        daily_scraping_limit: profile.daily_scraping_limit,
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

    const profilePath = path.join(PROFILES_DIR, name)
    if (fs.existsSync(profilePath)) {
      try {
        fs.rmSync(profilePath, { recursive: true, force: true })
      } catch (e) {
        logger.error({ err: e }, 'Error deleting profile directory')
      }
    }

    return true
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
