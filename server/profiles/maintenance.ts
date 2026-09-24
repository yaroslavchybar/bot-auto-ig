import { profileManager, type Profile } from './data.js'
import { lockProfile, validateProfileName } from './paths.js'
import { profilesBeginDelete, profilesGetByName, profilesList } from '../shared/convexClient.js'
import { automationMutex } from '../shared/mutex.js'
import { automationProfileSessions, profileProcesses } from '../shared/store.js'
import { stopProfileBrowserLocked } from './service.js'
import { stopAutomations } from '../automations/service.js'
import { AppError } from '../shared/errors.js'
import logger from '../shared/logger.js'
import { watchProfileMaintenance } from '../shared/convexRealtime.js'
import { reactiveWork } from '../shared/reactiveWork.js'

export function startProfileMaintenance(): () => void {
  const work = reactiveWork<string[]>({
    dueAt: ids => ids.length ? 0 : null,
    run: retryProfileMaintenance,
    onError: err => logger.warn({ err }, 'Profile maintenance failed'),
  })
  const subscription = watchProfileMaintenance(work.update, err => {
    work.update([])
    logger.error({ err }, 'Profile maintenance subscription failed')
  })
  void subscription.initial.catch(() => undefined)
  return () => { work.stop(); subscription.unsubscribe() }
}

async function stopOwners(names: string[]): Promise<void> {
  for (const name of names) {
    if (profileProcesses.has(name)) await stopProfileBrowserLocked(name)
  }
  for (const [automationId, profiles] of automationProfileSessions) {
    if (names.some(name => profiles.has(name))) await stopAutomations(automationId)
  }
}

async function withProfileLocks<T>(names: string[], action: () => Promise<T>): Promise<T> {
  const releases: Array<() => void> = []
  try {
    for (const name of [...new Set(names.map(n => n.toLowerCase()))].sort()) releases.push(lockProfile(name))
    return await action()
  } finally {
    for (const release of releases.reverse()) release()
  }
}

async function finishMaintenance(profile: Profile): Promise<void> {
  const names = [profile.name, ...(profile.renameFrom ? [profile.renameFrom] : [])]
  await stopOwners(names)
  await withProfileLocks(names, async () => {
    if (profile.status === 'deleting') await profileManager.finishDeletion(profile)
    else await profileManager.finishRename(profile)
  })
}

export async function deleteProfile(name: string): Promise<void> {
  validateProfileName(name)
  const release = await automationMutex.acquire()
  try {
    const profile = await profilesBeginDelete(name)
    if (!profile) return
    try {
      await finishMaintenance(profile)
    } catch (error) {
      logger.error({ err: error, profile: name }, 'Profile deletion pending; will retry')
      throw new AppError('Deletion is pending. Cleanup will retry automatically.', 503, 'PROFILE_DELETE_PENDING')
    }
  } finally { release() }
}

export async function updateProfile(oldName: string, profile: Profile): Promise<void> {
  validateProfileName(oldName)
  validateProfileName(profile.name)
  const release = await automationMutex.acquire()
  try {
    await stopOwners([oldName])
    await withProfileLocks([oldName, profile.name], async () => {
      if (!await profileManager.updateProfile(oldName, profile)) throw new AppError('Failed to update profile', 409, 'PROFILE_UPDATE_FAILED')
      const updated = await profilesGetByName(profile.name)
      if (updated?.renameFrom) {
        try { await profileManager.finishRename(updated) } catch (error) {
          logger.error({ err: error }, 'Profile rename pending; will retry')
          throw new AppError('Rename is pending. Folder moves will retry automatically.', 503, 'PROFILE_RENAME_PENDING')
        }
      }
    })
  } finally { release() }
}

let retrying = false
/** The database is the durable work queue; never infer deletion from missing rows. */
export async function retryProfileMaintenance(): Promise<void> {
  if (retrying) return
  retrying = true
  const release = await automationMutex.acquire()
  try {
    for (const profile of await profilesList()) {
      if (profile.status !== 'deleting' && !profile.renameFrom) continue
      try { await finishMaintenance(profile) } catch (error) {
        logger.warn({ err: error, profile: profile.name }, 'Profile maintenance will retry')
      }
    }
  } catch (error) {
    logger.warn({ err: error }, 'Could not load pending profile maintenance')
  } finally {
    release()
    retrying = false
  }
}
