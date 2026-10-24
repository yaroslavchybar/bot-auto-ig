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
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const usage = async (proxy: string) =>
      (await t.query(api.proxies.listPage, pageArgs)).page.find((row) => row.proxy === proxy)!.usage
    expect(await usage(first.proxy!)).toEqual({ count: 2, profileNames: ['First', 'Second'] })
    await t.mutation(internal.profiles.mutations.updateByNameInternal, { oldName: (await t.run(ctx => ctx.db.get(first._id)))!.name, name: 'Renamed' })
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
    await t.mutation(internal.profiles.mutations.updateByNameInternal, {
      oldName: (await t.run(ctx => ctx.db.get(first._id)))!.name,
      name: 'Renamed',
      proxy: '',
    })
    expect(await usage('http://next:8080')).toEqual({ count: 0, profileNames: [] })
    await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: second.name })
    expect(await usage(first.proxy!)).toEqual({ count: 1, profileNames: ['Second'] })
    await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: second._id })
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
