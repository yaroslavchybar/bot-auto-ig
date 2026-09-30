import { setChatCounterEnabled } from './chatCache'
import { v } from 'convex/values'
import { internalMutation, internalQuery, query, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { DomainError } from './errors'
import { requireServerBridgeAuth } from './serverBridgeAuth'

const status = v.union(
  v.literal('available'),
  v.literal('assigned'),
  v.literal('connected'),
  v.literal('invalid'),
)

export const listInternal = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('igAccounts').collect(),
})

export const pageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    count: v.number(),
    profileId: v.optional(v.id('profiles')),
  },
  handler: async (ctx, { cursor, count, profileId }) => {
    if (!Number.isInteger(count) || count < 1 || count > 50)
      throw new DomainError('VALIDATION', 'Invalid page size')
    const rows = ctx.db.query('igAccounts').withIndex('by_created')
    return (
      profileId
        ? rows.filter((q) =>
            q.or(q.eq(q.field('status'), 'available'), q.eq(q.field('profileId'), profileId)),
          )
        : rows
    ).paginate({ cursor, numItems: count })
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
  handler: async (ctx, { id }) => ctx.db.get(id),
})

export const byUsernameHashInternal = internalQuery({
  args: { usernameHash: v.string() },
  handler: async (ctx, { usernameHash }) =>
    ctx.db
      .query('igAccounts')
      .withIndex('by_username_hash', (q) => q.eq('usernameHash', usernameHash))
      .first(),
})

export const byProfileInternal = internalQuery({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) =>
    ctx.db
      .query('igAccounts')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first(),
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
    return rows
      .filter((row) => row.profileId)
      .map((row) => ({ profileId: row.profileId!, retryAfter: row.retryAfter ?? 0 }))
  },
})

export const connectedNamesInternal = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('igAccounts')
      .withIndex('by_status', (q) => q.eq('status', 'connected'))
      .paginate({ cursor: cursor ?? null, numItems: 100 })
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (account) => {
          const profile = account.profileId ? await ctx.db.get(account.profileId) : null
          return {
            account,
            profileName: profile?.name,
            renameFrom: profile?.renameFrom,
            profileStatus: profile?.status,
          }
        }),
      ),
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

export const modelSetupListInternal = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('modelSetupStates').collect(),
})

export const modelSetupEnrollInternal = internalMutation({
  args: { profileId: v.id('profiles'), modelId: v.id('lists'), startedAt: v.number() },
  handler: async (ctx, { profileId, modelId, startedAt }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile?.listIds?.includes(modelId) || !(await ctx.db.get(modelId)))
      throw new DomainError('VALIDATION', 'Profile is not assigned to this model')
    const existing = await ctx.db
      .query('modelSetupStates')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    if (existing?.modelId === modelId) return existing
    const progress = { profileId, modelId, startedAt, postSourceIds: [], postDates: [] }
    await ctx.db.patch(profileId, { outreachReady: false })
    if (existing) {
      await ctx.db.replace(existing._id, progress)
      return await ctx.db.get(existing._id)
    }
    return await ctx.db.get(await ctx.db.insert('modelSetupStates', progress))
  },
})

const modelSetupPatchKeys = new Set([
  'targetUsername',
  'fullName',
  'nameDone',
  'fullNameDone',
  'avatarSourceId',
  'avatarDone',
  'postSourceIds',
  'postDates',
  'outreachReadyMarked',
  'pending',
  'error',
])

function nineRecordedPosts(sourceIds: string[], dates: string[]): boolean {
  return sourceIds.length >= 9 && sourceIds.length === dates.length
}

export const modelSetupPatchInternal = internalMutation({
  args: { profileId: v.id('profiles'), patch: v.any(), clear: v.array(v.string()) },
  handler: async (ctx, { profileId, patch, clear }) => {
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      [...Object.keys(patch), ...clear].some((key) => !modelSetupPatchKeys.has(key))
    )
      throw new DomainError('VALIDATION', 'Invalid model setup update')
    if (
      patch.postSourceIds !== undefined &&
      (!Array.isArray(patch.postSourceIds) ||
        patch.postSourceIds.some((id: unknown) => typeof id !== 'string'))
    )
      throw new DomainError('VALIDATION', 'Invalid model setup update')
    if (
      patch.postDates !== undefined &&
      (!Array.isArray(patch.postDates) ||
        patch.postDates.some((date: unknown) => typeof date !== 'string'))
    )
      throw new DomainError('VALIDATION', 'Invalid model setup update')
    const state = await ctx.db
      .query('modelSetupStates')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    if (!state) throw new DomainError('NOT_FOUND', 'Model setup not found')
    const profile = await ctx.db.get(profileId)
    if (!profile?.listIds?.includes(state.modelId))
      throw new DomainError('CONFLICT', 'Profile moved to another model')
    const postsChanged = patch.postSourceIds !== undefined || patch.postDates !== undefined
    const ready = nineRecordedPosts(
      patch.postSourceIds ?? state.postSourceIds,
      patch.postDates ?? state.postDates,
    )
    if (patch.outreachReadyMarked === true && !ready)
      throw new DomainError('VALIDATION', 'Nine recorded posts are required for outreach')
    await ctx.db.patch(state._id, {
      ...patch,
      ...Object.fromEntries(clear.map((key) => [key, undefined])),
      ...(postsChanged ? { outreachReadyMarked: ready ? true : undefined } : {}),
    })
    if (ready && !profile.outreachReady) await ctx.db.patch(profileId, { outreachReady: true })
    if (postsChanged && !ready && profile.outreachReady)
      await ctx.db.patch(profileId, { outreachReady: false })
  },
})

/** Resolve one uncertain Instagram action exactly once after a human checks the account. */
export const modelSetupReconcileInternal = internalMutation({
  args: {
    profileId: v.id('profiles'),
    resolution: v.union(v.literal('completed'), v.literal('failed')),
  },
  handler: async (ctx, { profileId, resolution }) => {
    const state = await ctx.db
      .query('modelSetupStates')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    const profile = await ctx.db.get(profileId)
    if (!state?.pending || !profile?.listIds?.includes(state.modelId))
      throw new DomainError('CONFLICT', 'No active model setup action needs review')
    const action = state.pending
    if (resolution === 'failed') {
      await ctx.db.patch(state._id, { pending: undefined, error: undefined })
    } else if (action.kind === 'username' || action.kind === 'name') {
      if (!state.targetUsername) throw new DomainError('VALIDATION', 'Target username is missing')
      await ctx.db.patch(state._id, { nameDone: true, pending: undefined, error: undefined })
    } else if (action.kind === 'fullName') {
      if (!state.fullName) throw new DomainError('VALIDATION', 'Target full name is missing')
      await ctx.db.patch(state._id, { fullNameDone: true, pending: undefined, error: undefined })
    } else if (action.kind === 'avatar') {
      await ctx.db.patch(state._id, { avatarDone: true, pending: undefined, error: undefined })
    } else {
      if (!action.sourceId) throw new DomainError('VALIDATION', 'Post source is missing')
      const postSourceIds = [...state.postSourceIds, action.sourceId]
      const postDates = [...state.postDates, action.date]
      const ready = nineRecordedPosts(postSourceIds, postDates)
      await ctx.db.patch(state._id, {
        postSourceIds,
        postDates,
        pending: undefined,
        error: undefined,
        outreachReadyMarked: ready ? true : undefined,
      })
      if (ready && !profile.outreachReady) await ctx.db.patch(profileId, { outreachReady: true })
      if (!ready && profile.outreachReady) await ctx.db.patch(profileId, { outreachReady: false })
    }
    return { kind: action.kind, targetUsername: state.targetUsername }
  },
})

export const modelSetupGroupNameInternal = internalQuery({
  args: { modelId: v.id('lists'), group: v.number() },
  handler: async (ctx, { modelId, group }) =>
    (
      await ctx.db
        .query('modelSetupGroupNames')
        .withIndex('by_model_group', (q) => q.eq('modelId', modelId).eq('group', group))
        .first()
    )?.name ?? null,
})

export const modelSetupSaveGroupNameInternal = internalMutation({
  args: { modelId: v.id('lists'), group: v.number(), name: v.string() },
  handler: async (ctx, { modelId, group, name }) => {
    const existing = await ctx.db
      .query('modelSetupGroupNames')
      .withIndex('by_model_group', (q) => q.eq('modelId', modelId).eq('group', group))
      .first()
    if (existing) return existing.name
    await ctx.db.insert('modelSetupGroupNames', { modelId, group, name })
    return name
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
  args: { id: v.id('igAccounts'), loginProxyId: v.id('proxies'), token: v.string() },
  handler: async (ctx, { id, loginProxyId, token }) => {
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new DomainError('VALIDATION', 'Invalid login claim')
    const account = await ctx.db.get(id)
    const proxy = await ctx.db.get(loginProxyId)
    if (!account || account.status !== 'assigned' || proxy?.purpose !== 'login') return false
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
    if (!account || account.status !== 'assigned' || !profile || profile.status === 'deleting')
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
    await ctx.db.patch(id, { browserLoggedInAt, error: undefined, retryAfter: undefined })
    if (!profile.igLoggedIn) {
      await ctx.db.patch(profile._id, { igLoggedIn: true })
      await setChatCounterEnabled(ctx, profile._id, true)
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
