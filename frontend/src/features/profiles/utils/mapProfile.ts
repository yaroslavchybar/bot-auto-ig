import type { Profile } from '../types'
import type { Doc } from '../../../../../convex/_generated/dataModel'

/** UI projection. Cookies are excluded from list views but must be kept
 * when loading a profile into the edit form - otherwise saving the form
 * with an untouched (empty) cookies field silently wipes stored cookies. */
export function mapProfileRecord(
  record: Doc<'profiles'>,
  options?: { includeCookies?: boolean },
): Profile {
  return {
    id: record._id, name: record.name, proxy: record.proxy,
    proxyType: record.proxyType, fingerprintOs: record.fingerprintOs,
    status: record.status, using: record.using,
    renameFrom: record.renameFrom,
    igLoggedIn: record.igLoggedIn, unreadDms: record.unreadDms,
    outreachReady: record.outreachReady,
    ...(options?.includeCookies ? { cookiesJson: record.cookiesJson } : {}),
  }
}
