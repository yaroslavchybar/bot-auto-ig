import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'
import { proxyCountryZones } from '../../convex/proxyCountryZones'
import { requestsInHour, sessionWindow } from '../../convex/mobileRequestPolicy'

afterEach(() => vi.useRealTimers())

async function setup(country = 'ua') {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  const t = createConvexTest()
  const profileId = await t.run(async (ctx) => {
    await ctx.db.insert('proxies', {
      name: 'test',
      proxy: 'proxy.test:8000',
      proxyType: 'http',
      country,
      createdAt: 1,
    })
    return ctx.db.insert('profiles', {
      name: 'mobile',
      proxy: 'proxy.test:8000',
      proxyType: 'http',
      using: false,
      createdAt: 1,
    })
  })
  const reserve = (id: string) =>
    t.mutation(internal.mobileRequests.reserve, { profileId, requestId: id })
  return { t, profileId, reserve }
}

test('Mobile HTTP attempts share ten rolling-hour slots and retries do not double-charge', async () => {
  const s = await setup()
  const now = Date.now()
  for (let i = 0; i < 10; i++) expect((await s.reserve(`request-${i}`)).allowed).toBe(true)
  expect((await s.reserve('request-0')).allowed).toBe(true)
  expect(await s.reserve('request-10')).toMatchObject({ allowed: false, retryAt: now + 3_600_000 })
  expect(
    (await s.t.run((ctx) => ctx.db.query('mobileRequestUsage').unique()))?.requests,
  ).toHaveLength(10)
  vi.setSystemTime(now + 3_600_000)
  expect((await s.reserve('next-hour')).allowed).toBe(true)
})

test('proxy-country local sleep blocks calls without consuming slots', async () => {
  const s = await setup('us')
  vi.setSystemTime(new Date('2026-10-12T08:00:00Z')) // 04:00 in New York.
  const result = await s.reserve('sleeping')
  expect(result.allowed).toBe(false)
  expect(result.reason).toContain('sleeping')
  expect((await s.t.run((ctx) => ctx.db.query('mobileRequestUsage').unique()))?.requests).toEqual(
    [],
  )
  vi.setSystemTime(result.retryAt)
  expect((await s.reserve('awake')).allowed).toBe(true)
})

test('manual login is excluded from quota and can reconnect a paused profile', async () => {
  const { t, profileId, reserve } = await setup()
  for (let i = 0; i < 10; i++) expect((await reserve(`scrape-${i}`)).allowed).toBe(true)
  await t.run((ctx) => ctx.db.patch(profileId, { paused: true }))
  expect(await reserve('automatic')).toMatchObject({ allowed: false, reason: 'Profile is paused' })
  const reconnect = (requestId: string) =>
    t.mutation(internal.mobileRequests.reserve, {
      profileId,
      requestId,
      manualReconnect: true,
      login: true,
    })
  for (let i = 0; i < 20; i++) expect((await reconnect(`manual-${i}`)).allowed).toBe(true)
  expect(
    (await t.run((ctx) => ctx.db.query('mobileRequestUsage').unique()))?.requests,
  ).toHaveLength(10)
  expect(
    await t.mutation(internal.mobileRequests.reserve, {
      profileId,
      requestId: 'not-login',
      manualReconnect: true,
    }),
  ).toMatchObject({
    allowed: false,
    reason: 'Profile is paused',
  })
  expect((await t.run((ctx) => ctx.db.get(profileId)))?.paused).toBe(true)
  expect(await reserve('still-automatic')).toMatchObject({
    allowed: false,
    reason: 'Profile is paused',
  })
  await t.run((ctx) => ctx.db.patch(profileId, { paused: false }))
  expect(await reserve('still-limited')).toMatchObject({
    allowed: false,
    reason: 'Hourly mobile request limit reached',
  })
})

test('manual reconnect preserves the proxy-country sleep window', async () => {
  const { t, profileId } = await setup('us')
  await t.run((ctx) => ctx.db.patch(profileId, { paused: true }))
  vi.setSystemTime(new Date('2026-10-12T08:00:00Z'))
  expect(
    await t.mutation(internal.mobileRequests.reserve, {
      profileId,
      requestId: 'manual-asleep',
      manualReconnect: true,
      login: true,
    }),
  ).toMatchObject({ allowed: false, reason: 'Mobile session is sleeping' })
})

test('unknown proxy country never silently uses the server timezone', async () => {
  const s = await setup('zz')
  expect(await s.reserve('missing-country')).toMatchObject({
    allowed: false,
    reason: expect.stringContaining('country'),
  })
})

test('automatic login attempts do not create quota usage or analytics history', async () => {
  const { t, profileId, reserve } = await setup()
  for (let i = 0; i < 20; i++) {
    expect(
      (
        await t.mutation(internal.mobileRequests.reserve, {
          profileId,
          requestId: `login-${i}`,
          login: true,
        })
      ).allowed,
    ).toBe(true)
  }
  expect(await t.run((ctx) => ctx.db.query('mobileRequestUsage').unique())).toBeNull()
  await t.mutation(api.analytics.initialize, {})
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-12', period: 'all' })).quota
      .totalRequests,
  ).toBe(0)
  await reserve('previous-scrape')
  expect(
    (await t.run((ctx) => ctx.db.query('mobileRequestUsage').unique()))?.requests,
  ).toHaveLength(1)
})

test('login exemption still respects pause, sleep and proxy country', async () => {
  const { t, profileId } = await setup('us')
  await t.run((ctx) => ctx.db.patch(profileId, { paused: true }))
  const ready = (manualReconnect = false) =>
    t.mutation(internal.mobileRequests.reserve, {
      profileId,
      requestId: 'login',
      manualReconnect,
      login: true,
    })
  expect(await ready()).toMatchObject({ allowed: false, reason: 'Profile is paused' })
  vi.setSystemTime(new Date('2026-10-12T16:00:00Z'))
  expect((await ready(true)).allowed).toBe(true)
  vi.setSystemTime(new Date('2026-10-13T08:00:00Z'))
  expect(await ready(true)).toMatchObject({ allowed: false, reason: 'Mobile session is sleeping' })
  expect(await t.run((ctx) => ctx.db.query('mobileRequestUsage').unique())).toBeNull()
  expect((await t.run((ctx) => ctx.db.get(profileId)))?.paused).toBe(true)
  await t.run(async (ctx) => {
    const proxy = (await ctx.db.query('proxies').unique())!
    await ctx.db.patch(proxy._id, { country: 'zz' })
  })
  expect(await ready(true)).toMatchObject({
    allowed: false,
    reason: expect.stringContaining('country'),
  })
})

test('session windows remain stable, last sixteen hours, and follow country DST', () => {
  const id = 'session'
  const midday = Date.parse('2026-10-12T12:00:00Z')
  const window = sessionWindow(id, 'America/New_York', midday)
  expect(window.sleeping).toBe(false)
  const wake = sessionWindow(id, 'America/New_York', Date.parse('2026-10-12T08:00:00Z'))
  expect(wake.sleeping).toBe(true)
  expect(sessionWindow(id, 'America/New_York', wake.availableAt).activeEnd - wake.availableAt).toBe(
    16 * 3_600_000,
  )
  expect(sessionWindow(id, 'America/New_York', window.activeEnd).sleeping).toBe(true)
  expect(
    sessionWindow(id, 'America/New_York', window.activeEnd).availableAt - window.activeEnd,
  ).toBe(8 * 3_600_000)
  expect(requestsInHour([midday - 3_600_000, midday - 1, midday], midday)).toHaveLength(2)
})

test('country defaults are valid timezones and Ukrainian proxies use Kyiv', () => {
  expect(proxyCountryZones.ua).toBe('Europe/Kyiv')
  for (const timezone of Object.values(proxyCountryZones))
    expect(() => sessionWindow('profile', timezone, Date.now())).not.toThrow()
  const summer = sessionWindow('profile', 'Europe/Kyiv', Date.parse('2026-07-01T00:00:00Z'))
  const winter = sessionWindow('profile', 'Europe/Kyiv', Date.parse('2026-12-01T00:00:00Z'))
  expect(new Date(summer.availableAt).getUTCHours() + 1).toBe(
    new Date(winter.availableAt).getUTCHours(),
  )
})

test('request history starts before opening Analytics and bridge retries count once', async () => {
  const s = await setup()
  await s.reserve('first')
  await s.reserve('first')
  await s.t.mutation(api.analytics.initialize, {})
  expect(
    (await s.t.query(api.analytics.overview, { date: '2026-10-12', period: 'all' })).quota
      .totalRequests,
  ).toBe(1)
  await s.reserve('second')
  await s.t.mutation(api.analytics.initialize, {})
  expect(
    (await s.t.query(api.analytics.overview, { date: '2026-10-12', period: 'all' })).quota
      .totalRequests,
  ).toBe(2)
})

test('parallel callers cannot overbook a session and saved country changes affect scheduling', async () => {
  const s = await setup('us')
  vi.setSystemTime(Date.parse('2026-10-12T16:00:00Z'))
  const results = await Promise.all(
    Array.from({ length: 15 }, (_, i) => s.reserve(`parallel-${i}`)),
  )
  expect(results.filter((result) => result.allowed)).toHaveLength(10)
  vi.setSystemTime(Date.parse('2026-10-13T07:00:00Z')) // New York is asleep; Kyiv is awake.
  expect((await s.reserve('asleep')).allowed).toBe(false)
  await s.t.run(async (ctx) => {
    const proxy = (await ctx.db.query('proxies').unique())!
    await ctx.db.patch(proxy._id, { country: 'ua' })
  })
  expect((await s.reserve('new-country')).allowed).toBe(true)
})
