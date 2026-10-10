import { DomainError } from './errors'
import { v } from 'convex/values'
import { internalQuery, mutation, query } from './_generated/server'
import { normalizeProxy, proxyKey } from '../server/shared/proxy'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import {
  scanPage,
  matchesSearch,
  SCAN_BATCH_BYTES,
  type CursorPage,
} from '../server/shared/pagination'
export { proxyKey } from '../server/shared/proxy'

export const DEFAULT_MAX_PROFILES = 3
const purposeValidator = v.union(v.literal('work'), v.literal('login'))
export type ProxyPurpose = 'work' | 'login'

export function proxyPurpose(row: { purpose?: ProxyPurpose }): ProxyPurpose {
  return row.purpose ?? 'work'
}

export function cleanProxyFields(proxy: unknown, proxyType: unknown) {
  try {
    return normalizeProxy(proxy, proxyType)
  } catch {
    throw new DomainError('VALIDATION', 'Invalid proxy URL or protocol')
  }
}

export function resolveMaxProfiles(row: { maxProfiles?: unknown }): number {
  const n = typeof row.maxProfiles === 'number' ? Math.floor(row.maxProfiles) : NaN
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_PROFILES
}

type ProxyListRow = Pick<
  Doc<'proxies'>,
  '_id' | 'name' | 'proxy' | 'proxyType' | 'country' | 'loginCooldownUntil'
> & { purpose: ProxyPurpose; maxProfiles: number }
type ProxyPageRow = ProxyListRow & { usage: { count: number; profileNames: string[] } }

export const listBatchInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    count: v.number(),
    purpose: v.optional(purposeValidator),
  },
  handler: async (ctx, { cursor, count, purpose }): Promise<CursorPage<ProxyListRow>> => {
    const rows = ctx.db.query('proxies').withIndex('by_created')
    const filtered =
      purpose === 'work'
        ? rows.filter((q) => q.neq(q.field('purpose'), 'login'))
        : purpose === 'login'
          ? rows.filter((q) => q.eq(q.field('purpose'), 'login'))
          : rows
    const result = await filtered.paginate({
      cursor,
      numItems: count,
      maximumRowsRead: 50,
      maximumBytesRead: SCAN_BATCH_BYTES,
    })
    return {
      ...result,
      page: result.page.map((row) => ({
        _id: row._id,
        name: row.name,
        proxy: row.proxy,
        proxyType: row.proxyType,
        country: row.country,
        loginCooldownUntil: row.loginCooldownUntil,
        purpose: proxyPurpose(row),
        maxProfiles: resolveMaxProfiles(row),
      })),
    }
  },
})

export const listPage = query({
  args: {
    search: v.string(),
    cursor: v.union(v.string(), v.null()),
    purpose: v.optional(purposeValidator),
  },
  handler: async (ctx, { search, cursor, purpose }): Promise<CursorPage<ProxyPageRow>> => {
    const term = search.trim().toLowerCase()
    const result = await scanPage<ProxyListRow>(
      (next, count) =>
        ctx.runQuery(internal.proxies.listBatchInternal, { cursor: next, count, purpose }),
      (row) => matchesSearch(term, [row.name, row.proxy, row.proxyType, row.purpose, row.country]),
      cursor,
    )
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (row) => {
          const profiles =
            row.purpose === 'work'
              ? await ctx.db
                  .query('profiles')
                  .withIndex('by_proxy', (q) =>
                    q.eq('proxy', row.proxy).eq('proxyType', row.proxyType),
                  )
                  .collect()
              : []
          return {
            ...row,
            usage: {
              count: profiles.length,
              profileNames: profiles
                .map((profile) => profile.name)
                .sort((a, b) => a.localeCompare(b)),
            },
          }
        }),
      ),
    }
  },
})

function cleanName(name: unknown) {
  const cleaned = String(name || '').trim()
  if (!cleaned) throw new DomainError('VALIDATION', 'name is required')
  return cleaned
}

function cleanMaxProfiles(maxProfiles: unknown): number {
  if (typeof maxProfiles === 'undefined') return DEFAULT_MAX_PROFILES
  const n = typeof maxProfiles === 'number' ? Math.floor(maxProfiles) : NaN
  if (!Number.isFinite(n) || n < 1) {
    throw new DomainError('VALIDATION', 'limit must be at least 1')
  }
  return n
}

function cleanCountry(country: unknown, purpose: ProxyPurpose): string | undefined {
  const value = typeof country === 'string' ? country.trim().toLowerCase() : ''
  if (!value && purpose === 'work') return undefined
  if (!/^[a-z]{2}$/.test(value))
    throw new DomainError('VALIDATION', 'Choose a two-letter proxy country')
  return value
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('proxies').collect()
    rows.sort((a, b) => a.createdAt - b.createdAt)
    return rows.map((row) => ({
      ...row,
      purpose: proxyPurpose(row),
      maxProfiles: resolveMaxProfiles(row),
    }))
  },
})

export const loginInternal = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query('proxies')
      .withIndex('by_purpose', (q) => q.eq('purpose', 'login'))
      .collect(),
})

export const importMany = mutation({
  args: {
    text: v.string(),
    proxyType: v.union(v.literal('http'), v.literal('socks5')),
    purpose: purposeValidator,
    country: v.string(),
  },
  handler: async (ctx, { text, proxyType, purpose, country }) => {
    const normalizedCountry = cleanCountry(country, purpose)
    if (!normalizedCountry) throw new DomainError('VALIDATION', 'Choose an import country')
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length > 500)
      throw new DomainError('VALIDATION', 'Import at most 500 proxies at a time')
    const existing = await ctx.db.query('proxies').collect()
    const seen = new Set(existing.map((row) => proxyKey(row.proxy, row.proxyType)))
    const names = new Set(existing.map((row) => row.name))
    let imported = 0
    for (const [index, line] of lines.entries()) {
      let fields: ReturnType<typeof cleanProxyFields>
      try {
        fields = cleanProxyFields(line, proxyType)
      } catch {
        throw new DomainError('VALIDATION', `Invalid proxy on line ${index + 1}`)
      }
      if (!fields.proxy) throw new DomainError('VALIDATION', `Invalid proxy on line ${index + 1}`)
      if (fields.proxyType !== proxyType)
        throw new DomainError(
          'VALIDATION',
          `Proxy type on line ${index + 1} does not match the selected type`,
        )
      const key = proxyKey(fields.proxy, fields.proxyType)
      if (!key) throw new DomainError('VALIDATION', `Invalid proxy on line ${index + 1}`)
      if (seen.has(key)) continue
      const host = new URL(fields.proxy).hostname.replaceAll(/[^a-zA-Z0-9.-]/g, '_')
      let name = host
      let suffix = 2
      while (names.has(name)) name = `${host}-${suffix++}`
      await ctx.db.insert('proxies', {
        name,
        ...fields,
        purpose,
        country: normalizedCountry,
        maxProfiles: DEFAULT_MAX_PROFILES,
        createdAt: Date.now(),
      })
      names.add(name)
      seen.add(key)
      imported++
    }
    return { imported, skipped: lines.length - imported }
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    proxy: v.string(),
    proxyType: v.string(),
    purpose: v.optional(purposeValidator),
    country: v.optional(v.string()),
    maxProfiles: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const name = cleanName(args.name)
    const { proxy, proxyType } = cleanProxyFields(args.proxy, args.proxyType)
    if (!proxy) throw new DomainError('VALIDATION', 'proxy is required')
    const maxProfiles = cleanMaxProfiles(args.maxProfiles)
    const purpose = args.purpose ?? 'work'
    const country = cleanCountry(args.country, purpose)
    const existing = await ctx.db
      .query('proxies')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    if (existing) throw new DomainError('VALIDATION', 'Name already exists')
    const rows = await ctx.db.query('proxies').collect()
    if (rows.some((row) => proxyKey(row.proxy, row.proxyType) === proxy))
      throw new DomainError('VALIDATION', 'Proxy already exists')
    const id = await ctx.db.insert('proxies', {
      name,
      proxy,
      proxyType,
      purpose,
      country,
      maxProfiles,
      createdAt: Date.now(),
    })
    return await ctx.db.get(id)
  },
})

export const update = mutation({
  args: {
    id: v.id('proxies'),
    name: v.string(),
    proxy: v.string(),
    proxyType: v.string(),
    purpose: v.optional(purposeValidator),
    country: v.optional(v.string()),
    maxProfiles: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const name = cleanName(args.name)
    const { proxy, proxyType } = cleanProxyFields(args.proxy, args.proxyType)
    if (!proxy) throw new DomainError('VALIDATION', 'proxy is required')
    const maxProfiles = cleanMaxProfiles(args.maxProfiles)
    const existing = await ctx.db.get(args.id)
    if (!existing) throw new DomainError('NOT_FOUND', 'Proxy not found')
    const rows = await ctx.db.query('proxies').collect()
    if (rows.some((row) => row._id !== args.id && proxyKey(row.proxy, row.proxyType) === proxy))
      throw new DomainError('VALIDATION', 'Proxy already exists')
    if (name !== existing.name) {
      const clash = await ctx.db
        .query('proxies')
        .withIndex('by_name', (q) => q.eq('name', name))
        .first()
      if (clash) throw new DomainError('VALIDATION', 'Name already exists')
    }
    const oldKey = proxyKey(existing.proxy, existing.proxyType)
    const profiles = await ctx.db.query('profiles').collect()
    const assigned = oldKey
      ? profiles.filter((profile) => proxyKey(profile.proxy, profile.proxyType) === oldKey)
      : []
    const purpose = args.purpose ?? proxyPurpose(existing)
    const country = cleanCountry(args.country ?? existing.country, purpose)
    if ((oldKey !== proxy || purpose !== proxyPurpose(existing)) &&
        ((existing.loginClaim?.expiresAt ?? 0) > Date.now() || (existing.loginCooldownUntil ?? 0) > Date.now()))
      throw new DomainError('CONFLICT', 'Wait for the login claim and cooldown to finish before changing this proxy')
    if (purpose === 'login' && assigned.length)
      throw new DomainError('CONFLICT', 'Reassign profiles before marking this proxy for login')
    if (oldKey === proxy && assigned.length > maxProfiles)
      throw new DomainError('VALIDATION', 'Profile limit is too small for the assigned profiles')
    if (oldKey && oldKey !== proxy) {
      if (
        assigned.some(
          (profile) =>
            profile.using ||
            profile.status === 'running' ||
            profile.status === 'starting' ||
            profile.status === 'deleting' ||
            profile.renameFrom,
        )
      )
        throw new DomainError(
          'CONFLICT',
          'Stop assigned profiles and wait for maintenance before changing their proxy',
        )
      const targetCount = profiles.filter(
        (profile) => proxyKey(profile.proxy, profile.proxyType) === proxy,
      ).length
      if (targetCount + assigned.length > maxProfiles)
        throw new DomainError('VALIDATION', 'Profile limit is too small for the assigned profiles')
      for (const profile of assigned)
        await ctx.db.patch(profile._id, { proxy, proxyType, mode: 'proxy' })
    }
    await ctx.db.patch(args.id, { name, proxy, proxyType, purpose, country, maxProfiles })
    return await ctx.db.get(args.id)
  },
})

export const remove = mutation({
  args: { id: v.id('proxies') },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing) return true
    if ((existing.loginClaim?.expiresAt ?? 0) > Date.now() || (existing.loginCooldownUntil ?? 0) > Date.now())
      throw new DomainError('CONFLICT', 'Wait for the login claim and cooldown to finish before deleting this proxy')
    const key = proxyKey(existing.proxy, existing.proxyType)
    const profiles = await ctx.db.query('profiles').collect()
    if (key && profiles.some((profile) => proxyKey(profile.proxy, profile.proxyType) === key))
      throw new DomainError('CONFLICT', 'Reassign profiles before deleting this proxy')
    await ctx.db.delete(args.id)
    return true
  },
})

// One-time backfill: save proxies currently stored on profiles that
// have no matching row yet. Deduped by proxy value; safe to rerun.
export const importFromProfiles = mutation({
  args: {},
  handler: async (ctx) => {
    const proxies = await ctx.db.query('proxies').collect()
    const seen = new Set(proxies.map((p) => proxyKey(p.proxy, p.proxyType)))
    const taken = new Set(proxies.map((p) => p.name))
    const profiles = await ctx.db.query('profiles').collect()
    profiles.sort((a, b) => a.createdAt - b.createdAt)
    let imported = 0
    for (const profile of profiles) {
      const key = proxyKey(profile.proxy, profile.proxyType)
      if (!key || seen.has(key)) continue
      const { proxyType } = normalizeProxy(key)
      const base = String((profile as any).name || '').trim() || key
      let name = base
      let n = 2
      while (taken.has(name)) {
        name = `${base} ${n++}`
      }
      await ctx.db.insert('proxies', {
        name,
        proxy: key,
        proxyType,
        purpose: 'work',
        maxProfiles: DEFAULT_MAX_PROFILES,
        createdAt: Date.now(),
      })
      seen.add(key)
      taken.add(name)
      imported += 1
    }
    return { imported }
  },
})
