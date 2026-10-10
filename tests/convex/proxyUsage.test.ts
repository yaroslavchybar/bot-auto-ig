import { expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, seedProfile } from './helpers'

const pageArgs = { search: '', cursor: null, pageSize: 50 }

async function withTimers(run: () => Promise<void>) {
  vi.useFakeTimers()
  try {
    await run()
  } finally {
    vi.useRealTimers()
  }
}

test('proxy usage follows create, rename, reassignment, direct connection and deletion', () =>
  withTimers(async () => {
    const t = createConvexTest()
    const first = (await seedProfile(t, {
      name: 'First',
      proxy: 'http://first:8080',
      proxyType: 'http',
    }))!
    const second = (await seedProfile(t, {
      name: 'Second',
      proxy: first.proxy,
      proxyType: 'http',
    }))!
    await t.mutation(api.proxyUsage.ensure, {})
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const usage = async (proxy: string) =>
      (await t.query(api.proxies.listPage, pageArgs)).page.find((row) => row.proxy === proxy)!.usage
    expect(await usage(first.proxy!)).toEqual({ count: 2, profileNames: ['First', 'Second'] })
    await t.mutation(api.profiles.mutations.updateById, { profileId: first._id, name: 'Renamed' })
    expect(await usage(first.proxy!)).toEqual({ count: 2, profileNames: ['Renamed', 'Second'] })
    await t.mutation(internal.profiles.mutations.finishRenameInternal, { profileId: first._id })
    await t.mutation(internal.profiles.mutations.updateByNameInternal, {
      oldName: 'Renamed',
      name: 'Renamed',
      proxy: 'http://next:8080',
      proxyType: 'http',
    })
    expect(await usage(first.proxy!)).toEqual({ count: 1, profileNames: ['Second'] })
    expect(await usage('http://next:8080')).toEqual({ count: 1, profileNames: ['Renamed'] })
    await t.mutation(api.profiles.mutations.updateById, {
      profileId: first._id,
      name: 'Renamed',
      proxy: '',
    })
    expect(await usage('http://next:8080')).toEqual({ count: 0, profileNames: [] })
    await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: second.name })
    expect(await usage(first.proxy!)).toEqual({ count: 1, profileNames: ['Second'] })
    await t.mutation(internal.profiles.mutations.removeByNameInternal, { name: second.name })
    expect(await usage(first.proxy!)).toEqual({ count: 0, profileNames: [] })
    const third = (await seedProfile(t, { name: 'Third', proxy: first.proxy, proxyType: 'http' }))!
    await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: third.name })
    await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: third._id })
    expect(await usage(first.proxy!)).toEqual({ count: 0, profileNames: [] })
  }))

test('editing a saved proxy moves its lightweight assignments atomically', () =>
  withTimers(async () => {
    const t = createConvexTest()
    await seedProfile(t, { name: 'Assigned', proxy: 'http://old:8080', proxyType: 'http' })
    await t.mutation(api.proxyUsage.ensure, {})
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const [proxy] = (await t.query(api.proxies.listPage, pageArgs)).page
    await t.mutation(api.proxies.update, {
      id: proxy._id,
      name: proxy.name,
      proxy: 'http://new:8080',
      proxyType: 'http',
    })
    const [updated] = (await t.query(api.proxies.listPage, pageArgs)).page
    expect(updated.proxy).toBe('http://new:8080')
    expect(updated.usage).toEqual({ count: 1, profileNames: ['Assigned'] })
    expect(await t.run((ctx) => ctx.db.query('proxyProfileAssignments').collect())).toMatchObject([
      { name: 'Assigned', proxy: 'http://new:8080' },
    ])
  }))

test('existing profiles backfill in bounded pages without losing concurrent changes', () =>
  withTimers(async () => {
    const t = createConvexTest()
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert('proxies', {
        name: 'Existing',
        proxy: 'http://existing:8080',
        proxyType: 'http',
        maxProfiles: 500,
        createdAt: 0,
      })
      const ids = []
      for (let i = 0; i < 205; i++)
        ids.push(
          await ctx.db.insert('profiles', {
            name: `Existing-${i}`,
            proxy: 'http://existing:8080',
            proxyType: 'http',
            createdAt: i,
            using: false,
            cookiesJson: 'private session data',
          }),
        )
      ids.push(
        await ctx.db.insert('profiles', {
          name: 'Invalid old proxy',
          proxy: 'invalid://value',
          createdAt: 206,
          using: false,
        }),
      )
      return ids
    })
    expect((await t.query(api.proxies.listPage, pageArgs)).page[0].usage.count).toBe(205)
    await t.mutation(api.proxyUsage.ensure, {})
    await t.mutation(api.proxyUsage.ensure, {})
    expect(
      await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect()),
    ).toHaveLength(1)
    await t.mutation(internal.proxyUsage.backfill, { cursor: null })
    expect(await t.run((ctx) => ctx.db.query('proxyProfileAssignments').collect())).toHaveLength(
      100,
    )
    await t.mutation(api.profiles.mutations.updateById, {
      profileId: ids[0],
      name: 'Updated',
      proxy: '',
    })
    await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'Existing-1' })
    await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: ids[1] })
    await seedProfile(t, { name: 'New', proxy: 'http://existing:8080', proxyType: 'http' })
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const result = await t.query(api.proxies.listPage, pageArgs)
    expect(result.usageReady).toBe(true)
    expect(result.page[0].usage.count).toBe(204)
    expect(result.page[0].usage.profileNames).toContain('New')
    expect(result.page[0].usage.profileNames).not.toContain('Existing-0')
    expect(result.page[0].usage.profileNames).not.toContain('Existing-1')
    const before = await t.run((ctx) => ctx.db.query('proxyProfileAssignments').collect())
    await t.mutation(api.profiles.mutations.setIgState, { profileId: ids[2], igLoggedIn: true })
    await t.mutation(api.profiles.mutations.updateById, {
      profileId: ids[2],
      name: 'Existing-2',
      cookiesJson: 'changed cookies',
    })
    expect(await t.run((ctx) => ctx.db.query('proxyProfileAssignments').collect())).toEqual(before)
    expect(before.every((row) => !('cookiesJson' in row))).toBe(true)
    await t.mutation(api.proxyUsage.ensure, {})
    expect((await t.query(api.proxies.listPage, pageArgs)).page[0].usage.count).toBe(204)
  }))
