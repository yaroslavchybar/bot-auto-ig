import type { Profile } from '../types'
import type { Doc } from '../../../../../convex/_generated/dataModel'

/** UI projection. Cookies are excluded from list views but must be kept
 * when loading a profile into the edit form - otherwise saving the form
 * with an untouched (empty) cookies field silently wipes stored cookies. */
export function mapProfileRecord(
  record: Pick<
    Doc<'profiles'>,
    | '_id'
    | 'name'
    | 'proxy'
    | 'proxyType'
    | 'fingerprintOs'
    | 'status'
    | 'inUse'
    | 'paused'
    | 'pendingRenameFrom'
    | 'igLoggedIn'
    | 'outreachReady'
    | 'unreadChatCount'
    | 'unreadChatsCheckedAt'
    | 'cookiesJson'
  > & { attention?: Profile['attention'] },
  options?: { includeCookies?: boolean },
): Profile {
  return {
    id: record._id,
    attention: record.attention,
    name: record.name,
    proxy: record.proxy,
    proxyType: record.proxyType,
    fingerprintOs: record.fingerprintOs,
    status: record.status,
    inUse: record.inUse,
    paused: record.paused,
    pendingRenameFrom: record.pendingRenameFrom,
    igLoggedIn: record.igLoggedIn,
    outreachReady: record.outreachReady,
    unreadChatCount: record.unreadChatCount,
    unreadChatsCheckedAt: record.unreadChatsCheckedAt,
    ...(options?.includeCookies ? { cookiesJson: record.cookiesJson } : {}),
  }
}
