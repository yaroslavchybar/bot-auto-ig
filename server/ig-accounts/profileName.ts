import { profilesGetById } from '../shared/convexClient.js'
import logger from '../shared/logger.js'
import { updateProfile } from '../profiles/maintenance.js'
import { setAccountState } from './store.js'

const syncErrorPrefix = 'Profile name sync failed: '

/** Rename through profile maintenance so the browser directory follows the IG username. */
export async function syncConnectedProfileName(
  profileId: string,
  accountId: string,
  username: string,
): Promise<void> {
  try {
    const profile = await profilesGetById(profileId)
    if (!profile) throw new Error('Profile not found')
    if (profile.renameFrom) throw new Error('Profile rename is still in progress')
    if (profile.name !== username) await updateProfile(profile.name, { name: username })
    await setAccountState(accountId, 'connected')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logger.warn({ profileId, error: detail }, 'Could not sync profile name with IG username')
    await setAccountState(accountId, 'connected', `${syncErrorPrefix}${detail}`)
  }
}

export function profileNameSyncPending(error?: string): boolean {
  return error?.startsWith(syncErrorPrefix) ?? false
}
