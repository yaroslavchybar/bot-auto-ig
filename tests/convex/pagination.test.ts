import { expect, test } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'

test('available counts stay exact through 100 and indicate larger totals', async () => {
  const t = createConvexTest()
  expect(await t.query(internal.igAccounts.availableCountInternal, {})).toEqual({ available: 0 })
  await t.run(async (ctx) => {
    for (let i = 0; i < 100; i++)
      await ctx.db.insert('igAccounts', {
        ciphertext: 'encrypted',
        usernameHash: String(i),
        createdAt: i,
        status: 'available',
      })
    await ctx.db.insert('igAccounts', {
      ciphertext: 'encrypted',
      usernameHash: 'assigned',
      createdAt: 100,
      status: 'assigned',
    })
  })
  expect(await t.query(internal.igAccounts.availableCountInternal, {})).toEqual({ available: 100 })
  await t.run(async (ctx) => {
    for (let i = 100; i < 250; i++)
      await ctx.db.insert('igAccounts', {
        ciphertext: 'encrypted',
        usernameHash: String(i),
        createdAt: i,
        status: 'available',
      })
  })
  expect(await t.query(internal.igAccounts.availableCountInternal, {})).toEqual({
    available: 100,
    capped: true,
  })
})

test('profile and proxy searches return partial cursors before distant matches', async () => {
  const t = createConvexTest()
  await t.run(async (ctx) => {
    for (let i = 0; i < 310; i++) {
      const name = i === 300 ? 'distant-target' : `other-${i}`
      await ctx.db.insert('profiles', { name, createdAt: i, using: false })
      await ctx.db.insert('proxies', {
        name,
        createdAt: i,
        proxy: `http://proxy-${i}.example:8000`,
        proxyType: 'http',
      })
    }
  })
  for (const query of [api.profiles.queries.listPage, api.proxies.listPage]) {
    const first = await t.query(query, { search: 'distant-target', cursor: null, pageSize: 50 })
    expect(first.page).toEqual([])
    expect(first.isDone).toBe(false)
    expect(first.continueCursor).toBeTruthy()
    const second = await t.query(query, {
      search: 'distant-target',
      cursor: first.continueCursor,
      pageSize: 50,
    })
    expect(second.page.map((row) => row.name)).toEqual(['distant-target'])
    expect(second.isDone).toBe(true)
  }
})

test('profile pagination stays bounded, excludes cookies, and searches beyond the first page', async () => {
  const t = createConvexTest()
  await t.run(async (ctx) => {
    for (let i = 0; i < 125; i++)
      await ctx.db.insert('profiles', {
        name: i >= 60 ? `target-${i}` : `profile-${i}`,
        createdAt: 1,
        using: false,
        cookiesJson: 'private',
        sessionId: 'private',
      })
  })
  const first = await t.query(api.profiles.queries.listPage, {
    search: '',
    cursor: null,
    pageSize: 50,
  })
  expect(first.page).toHaveLength(50)
  expect(first.isDone).toBe(false)
  expect(first.page[0]).not.toHaveProperty('cookiesJson')
  expect(first.page[0]).not.toHaveProperty('sessionId')
  const second = await t.query(api.profiles.queries.listPage, {
    search: '',
    cursor: first.continueCursor,
    pageSize: 50,
  })
  expect(new Set([...first.page, ...second.page].map((row) => row._id)).size).toBe(100)
  const matches = await t.query(api.profiles.queries.listPage, {
    search: 'TARGET',
    cursor: null,
    pageSize: 50,
  })
  expect(matches.page).toHaveLength(50)
  expect(matches.page.every((row) => row.name.startsWith('target-'))).toBe(true)
  const remaining = await t.query(api.profiles.queries.listPage, {
    search: 'target',
    cursor: matches.continueCursor,
    pageSize: 50,
  })
  expect(remaining.page).toHaveLength(15)
  expect(remaining.isDone).toBe(true)
  const missing = await t.query(api.profiles.queries.listPage, {
    search: 'missing',
    cursor: null,
    pageSize: 50,
  })
  expect(missing.page).toEqual([])
  expect(missing.isDone).toBe(true)
})

test('profile pages honor the chosen page size and reject sizes outside the footer options', async () => {
  const t = createConvexTest()
  await t.run(async (ctx) => {
    for (let i = 0; i < 30; i++)
      await ctx.db.insert('profiles', { name: `profile-${i}`, createdAt: i, using: false })
  })
  const page = await t.query(api.profiles.queries.listPage, {
    search: '',
    cursor: null,
    pageSize: 10,
  })
  expect(page.page).toHaveLength(10)
  await expect(
    t.query(api.profiles.queries.listPage, { search: '', cursor: null, pageSize: 37 }),
  ).rejects.toThrow('Invalid page size')
})

test('proxy pages count profiles on every page without leaking login claims', async () => {
  const t = createConvexTest()
  await t.run(async (ctx) => {
    for (let i = 0; i < 70; i++)
      await ctx.db.insert('profiles', {
        name: `profile-${i}`,
        createdAt: i,
        using: false,
        proxy: 'http://proxy.example:8000',
        proxyType: 'http',
      })
    await ctx.db.insert('proxies', {
      name: 'Shared',
      proxy: 'http://proxy.example:8000',
      proxyType: 'http',
      createdAt: 1,
    })
  })
  const result = await t.query(api.proxies.listPage, { search: '', cursor: null, pageSize: 50 })
  expect(result.page[0].usage.count).toBe(70)
  expect(result.page[0].usage.profileNames).toHaveLength(70)
  expect(result.page[0]).not.toHaveProperty('loginClaim')
})

test('account pages and available counts cover all records and filter connectable options', async () => {
  const t = createConvexTest()
  const profileId = await t.run(async (ctx) => {
    const profile = await ctx.db.insert('profiles', { name: 'Owner', using: false, createdAt: 1 })
    for (let i = 0; i < 110; i++)
      await ctx.db.insert('igAccounts', {
        ciphertext: 'encrypted',
        usernameHash: String(i),
        createdAt: i,
        status: i < 100 ? 'available' : 'assigned',
        ...(i === 105 ? { profileId: profile } : {}),
      })
    return profile
  })
  expect(await t.query(internal.igAccounts.availableCountInternal, {})).toEqual({ available: 100 })
  const first = await t.query(internal.igAccounts.pageInternal, {
    cursor: null,
    count: 50,
    profileId,
  })
  const second = await t.query(internal.igAccounts.pageInternal, {
    cursor: first.continueCursor,
    count: 50,
    profileId,
  })
  const third = await t.query(internal.igAccounts.pageInternal, {
    cursor: second.continueCursor,
    count: 50,
    profileId,
  })
  expect(third.page).toHaveLength(1)
  expect(third.page[0].profileId).toBe(profileId)
  expect(third.isDone).toBe(true)
})

test('account option scans stop at a bounded cursor before distant available credentials', async () => {
  const t = createConvexTest()
  const profileId = await t.run(async ctx => {
    const id = await ctx.db.insert('profiles', { name: 'Owner', using: false, createdAt: 0 })
    for (let i = 0; i < 310; i++) await ctx.db.insert('igAccounts', {
      ciphertext: 'encrypted', usernameHash: String(i), createdAt: i,
      status: i === 300 ? 'available' : 'assigned',
    })
    return id
  })
  let cursor: string | null = null
  for (let i = 0; i < 3; i++) {
    const page = await t.query(internal.igAccounts.pageInternal, { cursor, count: 10, profileId })
    expect(page.page).toEqual([])
    expect(page.isDone).toBe(false)
    expect(page.continueCursor).not.toBe(cursor)
    cursor = page.continueCursor
  }
  const last = await t.query(internal.igAccounts.pageInternal, { cursor, count: 10, profileId })
  expect(last.page).toHaveLength(1)
  expect(last.page[0].usernameHash).toBe('300')
  expect(last.isDone).toBe(true)
})
