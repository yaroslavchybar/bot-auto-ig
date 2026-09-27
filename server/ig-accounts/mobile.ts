import { promises as fs } from 'node:fs'
import { InstagramChat } from '../chat/instagram.js'
import { profilesGetById } from '../shared/convexClient.js'

type MobileAction = { action: 'name'; targetUsername: string; fullName: string } |
  { action: 'avatar' | 'post'; imagePath: string }

/** Reuse the connected TypeScript mobile session. No browser or second login is needed. */
export async function runMobileAction(profileId: string, action: MobileAction):
  Promise<{ ok: true } | { ok: false; errorType: string }> {
  try {
    const profile = await profilesGetById(profileId)
    if (!profile) return { ok: false, errorType: 'ProfileMissing' }
    const chat = await InstagramChat.load(profile)
    if (action.action === 'name') await chat.updateProfile(action.targetUsername, action.fullName)
    else {
      const image = await fs.readFile(action.imagePath)
      if (action.action === 'avatar') await chat.changeProfilePicture(image)
      else await chat.postPhoto(image)
    }
    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const response = error && typeof error === 'object' && 'response' in error ?
      JSON.stringify((error as { response?: { body?: unknown } }).response?.body ?? {}) : ''
    const combined = `${detail} ${response}`
    if (/username/i.test(combined) && /taken|exists|unavailable|not available/i.test(combined))
      return { ok: false, errorType: 'UsernameUnavailable' }
    return { ok: false, errorType: error instanceof Error ? error.name : 'MobileActionError' }
  }
}
