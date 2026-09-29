import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { igAccountRequest } from '../shared/convexClient.js'
import { parseChatCredentials, type ChatCredentials } from '../chat/totp.js'

export type AccountStatus = 'available' | 'assigned' | 'connected' | 'invalid'
export type StoredAccount = ChatCredentials & {
  id: string
  status: AccountStatus
  profileId?: string
  error?: string
  createdAt: number
  retryAfter?: number
  browserLoggedInAt?: number
}

type EncryptedAccount = { usernameHash: string; ciphertext: string }
type DbAccount = EncryptedAccount & { _id: string; status: AccountStatus; profileId?: string;
  error?: string; createdAt: number; retryAfter?: number;
  browserLoggedInAt?: number }

function key(): Buffer {
  const value = process.env.IG_CREDENTIALS_KEY?.trim() ?? ''
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('IG_CREDENTIALS_KEY must be a 32-byte hex key')
  return Buffer.from(value, 'hex')
}

function usernameHash(username: string): string {
  const lookupKey = createHmac('sha256', key()).update('ig-username-lookup-v1').digest()
  return createHmac('sha256', lookupKey).update(username.toLowerCase()).digest('hex')
}

/** Only ciphertext and a keyed lookup hash are sent to Convex. */
export function encryptAccount(account: ChatCredentials): EncryptedAccount {
  const hash = usernameHash(account.username)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(hash, 'hex'))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(account), 'utf8'), cipher.final()])
  return { usernameHash: hash, ciphertext: ['v1', iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.') }
}

export function decryptAccount(row: EncryptedAccount): ChatCredentials {
  const parts = row.ciphertext.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^[0-9a-f]{64}$/.test(row.usernameHash))
    throw new Error('Invalid encrypted IG credential')
  const iv = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[2], 'base64url')
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted IG credential')
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAAD(Buffer.from(row.usernameHash, 'hex'))
  decipher.setAuthTag(tag)
  const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')),
    decipher.final()]).toString('utf8')) as ChatCredentials
  if (typeof value.username !== 'string' || typeof value.password !== 'string' ||
    typeof value.authenticatorKey !== 'string' || usernameHash(value.username) !== row.usernameHash)
    throw new Error('Invalid encrypted IG credential')
  return value
}

function account(row: DbAccount): StoredAccount {
  return { ...decryptAccount(row), id: row._id, status: row.status,
    profileId: row.profileId, error: row.error, createdAt: row.createdAt, retryAfter: row.retryAfter,
    browserLoggedInAt: row.browserLoggedInAt }
}

export function publicAccount(row: StoredAccount) {
  return { id: row.id, username: row.username, status: row.status,
    profileId: row.profileId, error: row.error, createdAt: row.createdAt,
    browserLoggedInAt: row.browserLoggedInAt }
}

export async function listAccounts() {
  const rows = await igAccountRequest<DbAccount[]>('list')
  return rows.map(row => {
    try { return publicAccount(account(row)) }
    catch { return { id: row._id, username: '', status: 'invalid' as const,
      profileId: row.profileId, error: 'Credential cannot be decrypted', createdAt: row.createdAt } }
  })
}

function readableAccounts(rows: DbAccount[]): StoredAccount[] {
  const readable: StoredAccount[] = []
  for (const row of rows) {
    try { readable.push(account(row)) }
    catch { /* Keep unreadable rows out of login and allocation batches. */ }
  }
  return readable
}

export async function importAccounts(text: string) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length > 1000) throw new Error('Import at most 1000 accounts at a time')
  const parsed = lines.map(parseChatCredentials)
  if (parsed.some(value => !value)) throw new Error('Every line must be username:password:2FA key')
  let imported = 0
  for (let start = 0; start < lines.length; start += 100) {
    const rows = (parsed.slice(start, start + 100) as ChatCredentials[]).map(encryptAccount)
    imported += (await igAccountRequest<{ imported: number }>('import', { rows })).imported
  }
  return { imported, skipped: lines.length - imported }
}

export async function accountById(id: string): Promise<StoredAccount | undefined> {
  const row = await igAccountRequest<DbAccount | null>('byId', { id })
  return row ? account(row) : undefined
}

export async function accountByUsername(username: string): Promise<StoredAccount | undefined> {
  const row = await igAccountRequest<DbAccount | null>('byUsernameHash', { usernameHash: usernameHash(username) })
  return row ? account(row) : undefined
}

export async function accountForProfile(profileId: string): Promise<StoredAccount | undefined> {
  const row = await igAccountRequest<DbAccount | null>('byProfile', { profileId })
  return row ? account(row) : undefined
}

export async function availableAccounts(count: number): Promise<StoredAccount[]> {
  const available: StoredAccount[] = []
  let cursor: string | undefined
  while (available.length < count) {
    const page: { page: DbAccount[]; continueCursor: string; isDone: boolean } =
      await igAccountRequest('available', { count: Math.max(20, count - available.length), cursor })
    available.push(...readableAccounts(page.page).slice(0, count - available.length))
    if (page.isDone) break
    cursor = page.continueCursor
  }
  return available
}

export async function connectedNames(): Promise<Array<{
  account: StoredAccount; profileName?: string; renameFrom?: string; profileStatus?: string }>> {
  const connected: Array<{
    account: StoredAccount; profileName?: string; renameFrom?: string; profileStatus?: string }> = []
  let cursor: string | undefined
  let isDone = false
  do {
    const result: { page: Array<{ account: DbAccount; profileName?: string;
      renameFrom?: string; profileStatus?: string }>;
      continueCursor: string; isDone: boolean } = await igAccountRequest('connectedNames', { cursor })
    for (const row of result.page) {
      try { connected.push({ account: account(row.account), profileName: row.profileName,
        renameFrom: row.renameFrom, profileStatus: row.profileStatus }) }
      catch { /* An unreadable credential cannot be renamed. */ }
    }
    isDone = result.isDone
    cursor = result.continueCursor
  } while (!isDone)
  return connected
}

export async function assignAccount(id: string, profileId: string): Promise<void> {
  await igAccountRequest('assign', { id, profileId })
}

export function claimLoginProxy(id: string, loginProxyId: string, token: string): Promise<boolean> {
  return igAccountRequest<boolean>('claimLoginProxy', { id, loginProxyId, token })
}

export async function releaseLoginProxy(id: string, loginProxyId: string, token: string): Promise<void> {
  await igAccountRequest('releaseLoginProxy', { id, loginProxyId, token })
}

export async function setAccountState(id: string, status: Exclude<AccountStatus, 'available'>,
  error?: string, retryAfter?: number): Promise<void> {
  await igAccountRequest('setState', { id, status, error, retryAfter })
}

export function recordBrowserLogin(id: string, browserLoggedInAt: number,
  loginProxyId: string, claimToken: string, cooldownMs: number): Promise<{ cooldownRecorded: boolean }> {
  return igAccountRequest('recordBrowserLogin', { id, browserLoggedInAt,
    loginProxyId, claimToken, cooldownMs })
}

export async function setAccountUsername(id: string, username: string): Promise<void> {
  if (!/^[a-z0-9._]{1,30}$/i.test(username)) throw new Error('Invalid IG username')
  const existing = await accountById(id)
  if (!existing) throw new Error('Credential not found')
  if (existing.username.toLowerCase() === username.toLowerCase()) return
  const encrypted = encryptAccount({ username, password: existing.password,
    authenticatorKey: existing.authenticatorKey })
  await igAccountRequest('setUsername', { id, ...encrypted })
}
