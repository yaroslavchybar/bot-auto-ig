import { connectionStatus, withConnectionStatus } from './accountConnection'
import type { Id } from './_generated/dataModel'
import { patchProfile } from './workerMetadata'
import { v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from './_generated/server'
import { DomainError } from './errors'
import { requireServerBridgeAuth } from './serverBridgeAuth'
import { MAX_PAGE_SIZE, SCAN_BATCH_BYTES } from '../server/shared/pagination'

const status = v.union(
  v.literal('available'),
  v.literal('assigned'),
  v.literal('connected'),
  v.literal('invalid'),
)

export const listInternal = internalQuery({
  args: {},
  handler: async (ctx) =>
    Promise.all(
      (await ctx.db.query('igAccounts').collect()).map((account) =>
        withConnectionStatus(ctx, account),
      ),
    ),
})

export const pageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    count: v.number(),
    profileId: v.optional(v.id('profiles')),
  },
  handler: async (ctx, { cursor, count, profileId }) => {
    if (!Number.isInteger(count) || count < 1 || count > MAX_PAGE_SIZE)
      throw new DomainError('VALIDATION', 'Invalid page size')
    const rows = ctx.db.query('igAccounts').withIndex('by_created')
    const page = await (
      profileId
        ? rows.filter((q) =>
            q.or(q.eq(q.field('status'), 'available'), q.eq(q.field('profileId'), profileId)),
          )
        : rows
    ).paginate({
      cursor,
      numItems: count,
      maximumRowsRead: MAX_PAGE_SIZE,
      maximumBytesRead: SCAN_BATCH_BYTES,
    })
    return {
      ...page,
      page: await Promise.all(page.page.map((account) => withConnectionStatus(ctx, account))),
    }
  },
})

export const availableCountInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Batch creation allows at most 100; read one extra row to indicate more.
    const limit = 100
    const rows = await ctx.db
      .query('igAccounts')
      .withIndex('by_status', (q) => q.eq('status', 'available'))
      .take(limit + 1)
    return {
      available: Math.min(rows.length, limit),
      ...(rows.length > limit ? { capped: true } : {}),
    }
  },
})

export const byIdInternal = internalQuery({
  args: { id: v.id('igAccounts') },
  handler: async (ctx, { id }) => {
    const account = await ctx.db.get(id)
    return account ? withConnectionStatus(ctx, account) : null
  },
})

export const byUsernameHashInternal = internalQuery({
  args: { usernameHash: v.string() },
  handler: async (ctx, { usernameHash }) => {
    const account = await ctx.db
      .query('igAccounts')
      .withIndex('by_username_hash', (q) => q.eq('usernameHash', usernameHash))
      .first()
    return account ? withConnectionStatus(ctx, account) : null
  },
})

export const byProfileInternal = internalQuery({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) => {
    const account = await ctx.db.query('igAccounts')
      .withIndex('by_profile', q => q.eq('profileId', profileId)).first()
    return account ? withConnectionStatus(ctx, account) : null
  },
})

/** Subscription payload contains only login timing, never credentials. */
export const loginWork = query({
  args: { bridgeToken: v.string() },
  handler: async (ctx, { bridgeToken }) => {
    requireServerBridgeAuth(bridgeToken)
    const rows = await ctx.db
      .query('igAccounts')
      .withIndex('by_status_browser_login', (q) =>
        q.eq('status', 'assigned').eq('browserLoggedInAt', undefined),
      )
      .take(100)
    const work = await Promise.all(
      rows
        .filter((row) => row.profileId)
        .map(async (row) => {
          const profile = await ctx.db.get(row.profileId!)
          return profile && !profile.paused && profile.status !== 'deleting' && !profile.pendingRenameFrom
            ? { profileId: row.profileId!, retryAfter: row.retryAfter ?? 0 }
            : null
        }),
    )
    return work.filter((row) => row !== null)
  },
})

export const connectedNamesInternal = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('igAccounts')
      .withIndex('by_created')
      .paginate({ cursor: cursor ?? null, numItems: 100 })
    return {
      ...page,
      page: (await Promise.all(
        page.page.map(async (account) => {
          const profile = account.profileId ? await ctx.db.get(account.profileId) : null
          return {
            account: { ...account, status: connectionStatus(account, profile) },
            profileName: profile?.name,
            pendingRenameFrom: profile?.pendingRenameFrom,
            profileStatus: profile?.status,
            profileUsing: profile?.inUse,
          }
        }),
      )).filter(row => row.account.status === 'connected'),
    }
  },
})

export const availableInternal = internalQuery({
  args: { count: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, { count, cursor }) => {
    if (!Number.isInteger(count) || count < 1 || count > 100)
      throw new DomainError('VALIDATION', 'Invalid account count')
    return ctx.db
      .query('igAccounts')
      .withIndex('by_status', (q) => q.eq('status', 'available'))
      .paginate({ cursor: cursor ?? null, numItems: count })
  },
})

export const importEncryptedInternal = internalMutation({
  args: { rows: v.array(v.object({ usernameHash: v.string(), ciphertext: v.string() })) },
  handler: async (ctx, { rows }) => {
    if (!rows.length || rows.length > 100)
      throw new DomainError('VALIDATION', 'Import 1–100 accounts per batch')
    const seen = new Set<string>()
    let imported = 0
    for (const row of rows) {
      if (
        !/^[0-9a-f]{64}$/.test(row.usernameHash) ||
        row.ciphertext.length > 8192 ||
        !row.ciphertext
      )
        throw new DomainError('VALIDATION', 'Invalid encrypted credential')
      if (seen.has(row.usernameHash)) continue
      seen.add(row.usernameHash)
      const existing = await ctx.db
        .query('igAccounts')
        .withIndex('by_username_hash', (q) => q.eq('usernameHash', row.usernameHash))
        .first()
      if (existing) continue
      await ctx.db.insert('igAccounts', { ...row, status: 'available', createdAt: Date.now() })
      imported++
    }
    return { imported, skipped: rows.length - imported }
  },
})

export const assignInternal = internalMutation({
  args: { id: v.id('igAccounts'), profileId: v.id('profiles') },
  handler: async (ctx, { id, profileId }) => {
    const account = await ctx.db.get(id)
    const profile = await ctx.db.get(profileId)
    if (!account || !profile || profile.status === 'deleting')
      throw new DomainError('NOT_FOUND', 'Credential or profile not found')
    if (
      account.profileId === profileId &&
      (account.status === 'assigned' || account.status === 'connected')
    )
      return
    if (account.status !== 'available')
      throw new DomainError('CONFLICT', 'Credential is not available')
    const existing = await ctx.db
      .query('igAccounts')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    if ((existing && existing._id !== id) || (profile.igAccountId && profile.igAccountId !== id))
      throw new DomainError('CONFLICT', 'Profile already has a credential')
    await ctx.db.patch(id, {
      status: 'assigned',
      profileId,
      error: undefined,
      retryAfter: undefined,
      browserLoggedInAt: undefined,
    })
    await ctx.db.patch(profileId, { igAccountId: id })
  },
})

const minLoginProxyCooldown = 3 * 24 * 60 * 60_000
const maxLoginProxyCooldown = 5 * 24 * 60 * 60_000
const loginClaimMs = 15 * 60_000

/** A Convex write serializes claims across workers before Instagram is contacted. */
export const claimLoginProxyInternal = internalMutation({
  args: {
    id: v.id('igAccounts'),
    loginProxyId: v.id('proxies'),
    proxy: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { id, loginProxyId, proxy: expectedProxy, token }) => {
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new DomainError('VALIDATION', 'Invalid login claim')
    const account = await ctx.db.get(id)
    const proxy = await ctx.db.get(loginProxyId)
    if (
      !account ||
      account.status !== 'assigned' ||
      proxy?.purpose !== 'login' ||
      proxy.proxy !== expectedProxy
    )
      return false
    const now = Date.now()
    if ((proxy.loginCooldownUntil ?? 0) > now || (proxy.loginClaim?.expiresAt ?? 0) > now)
      return false
    await ctx.db.patch(loginProxyId, {
      loginClaim: { accountId: id, token, expiresAt: now + loginClaimMs },
    })
    return true
  },
})

export const releaseLoginProxyInternal = internalMutation({
  args: { id: v.id('igAccounts'), loginProxyId: v.id('proxies'), token: v.string() },
  handler: async (ctx, { id, loginProxyId, token }) => {
    const proxy = await ctx.db.get(loginProxyId)
    if (proxy?.loginClaim?.accountId === id && proxy.loginClaim.token === token)
      await ctx.db.patch(loginProxyId, { loginClaim: undefined })
  },
})

async function finishLoginProxyClaim(
  ctx: MutationCtx,
  accountId: Id<'igAccounts'>,
  proxyId: Id<'proxies'>,
  token: string,
  cooldownMs: number,
): Promise<boolean> {
  if (
    !Number.isSafeInteger(cooldownMs) ||
    cooldownMs < minLoginProxyCooldown ||
    cooldownMs > maxLoginProxyCooldown
  )
    throw new DomainError('VALIDATION', 'Login proxy cooldown must be 3–5 days')
  const proxy = await ctx.db.get(proxyId)
  if (proxy?.purpose !== 'login') return false
  const now = Date.now()
  if (
    proxy.loginCooldownUntil &&
    proxy.loginCooldownUntil > now &&
    proxy.loginCooldownAccountId === accountId
  )
    return true
  if (proxy.loginClaim?.accountId !== accountId || proxy.loginClaim.token !== token) return false
  await ctx.db.patch(proxyId, {
    loginCooldownUntil: now + cooldownMs,
    loginCooldownAccountId: accountId,
    loginClaim: undefined,
  })
  return true
}

/** Commit the browser result and Login proxy cooldown together. */
export const recordBrowserLoginInternal = internalMutation({
  args: {
    id: v.id('igAccounts'),
    browserLoggedInAt: v.number(),
    loginProxyId: v.id('proxies'),
    claimToken: v.string(),
    cooldownMs: v.number(),
  },
  handler: async (ctx, { id, browserLoggedInAt, loginProxyId, claimToken, cooldownMs }) => {
    const account = await ctx.db.get(id)
    const profile = account?.profileId ? await ctx.db.get(account.profileId) : null
    if (
      !account ||
      !['assigned', 'connected'].includes(account.status) ||
      !profile ||
      profile.status === 'deleting'
    )
      throw new DomainError('CONFLICT', 'Credential is not assigned to an active profile')
    if (!Number.isSafeInteger(browserLoggedInAt) || browserLoggedInAt < 1)
      throw new DomainError('VALIDATION', 'Invalid browser login time')
    if (account.browserLoggedInAt && profile.igLoggedIn) return { cooldownRecorded: true }
    const cooldownRecorded = await finishLoginProxyClaim(
      ctx,
      id,
      loginProxyId,
      claimToken,
      cooldownMs,
    )
    await ctx.db.patch(id, {
      status: 'connected',
      browserLoggedInAt,
      error: undefined,
      retryAfter: undefined,
    })
    if (!profile.igLoggedIn) {
      await patchProfile(ctx, profile._id, { igLoggedIn: true })
    }
    return { cooldownRecorded }
  },
})

export const setStateInternal = internalMutation({
  args: {
    id: v.id('igAccounts'),
    status,
    error: v.optional(v.string()),
    retryAfter: v.optional(v.number()),
  },
  handler: async (ctx, { id, status, error, retryAfter }) => {
    if (retryAfter !== undefined) {
      if (retryAfter < 0 || !Number.isSafeInteger(Math.ceil(retryAfter)))
        throw new DomainError('VALIDATION', 'Invalid login retry time')
      retryAfter = Math.ceil(retryAfter)
    }
    const account = await ctx.db.get(id)
    if (!account) throw new DomainError('NOT_FOUND', 'Credential not found')
    if (status === 'available')
      throw new DomainError(
        'VALIDATION',
        'Release the profile before making a credential available',
      )
    if ((status === 'assigned' || status === 'connected') && !account.profileId)
      throw new DomainError('CONFLICT', 'Credential has no profile')
    if (account.status !== status || account.error !== error || account.retryAfter !== retryAfter)
      await ctx.db.patch(id, { status, error, retryAfter })
  },
})

export const setUsernameInternal = internalMutation({
  args: { id: v.id('igAccounts'), usernameHash: v.string(), ciphertext: v.string() },
  handler: async (ctx, { id, usernameHash, ciphertext }) => {
    if (!(await ctx.db.get(id))) throw new DomainError('NOT_FOUND', 'Credential not found')
    const existing = await ctx.db
      .query('igAccounts')
      .withIndex('by_username_hash', (q) => q.eq('usernameHash', usernameHash))
      .first()
    if (existing && existing._id !== id)
      throw new DomainError('CONFLICT', 'Username already belongs to another credential')
    await ctx.db.patch(id, { usernameHash, ciphertext })
  },
})
