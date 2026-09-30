import { InstagramChat } from '../chat/instagram.js'
import { profilesGetById } from '../shared/convexClient.js'
import { ValidationError } from '../shared/errors.js'
import { logOperation, redactLogValues } from '../shared/logger.js'
import { accountById } from './store.js'
import { syncConnectedProfileName } from './profileName.js'

const active = new Map<string, Promise<void>>()

/** Reuse saved credentials and the Work proxy; preserve the old session if login fails. */
export function reconnectAccount(id: string): Promise<void> {
  const pending = active.get(id)
  if (pending) return pending
  const operation = logOperation('instagram.reconnect', { accountId: id }, async () => {
    const account = await accountById(id)
    if (!account?.profileId || account.status !== 'connected')
      throw new ValidationError('Account is not connected to a profile')
    redactLogValues(account.password, account.authenticatorKey)
    const profile = await profilesGetById(account.profileId)
    if (!profile || profile.status === 'deleting')
      throw new ValidationError('Profile is unavailable')
    if (!profile.proxy) throw new ValidationError('Profile has no Work proxy')
    await InstagramChat.login(profile, account.username, account.password, account.authenticatorKey)
    await syncConnectedProfileName(profile.id, account.id, account.username)
  })
  active.set(id, operation)
  void operation.finally(() => active.delete(id)).catch(() => {})
  return operation
}
