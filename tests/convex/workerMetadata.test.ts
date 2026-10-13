import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { patchProfile } from '../../convex/workerMetadata'
import { createConvexTest } from './helpers'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

test('quota and cookies cannot change chat metadata, while proxy, login and session changes do', async () => {
  const t = createConvexTest()
  const profile = await t.mutation(api.profiles.mutations.create, { name: 'profile' })
  const profileId = profile!._id
  await t.mutation(api.profiles.mutations.setIgState, { profileId, igLoggedIn: true })
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['session'])))
  await t.mutation(internal.profiles.mutations.saveMobileSessionInternal, {
    profileId,
    storageId,
    token: 'token',
  })
  const before = await t.run((ctx) => ctx.db.query('chatWorkerMetadata').unique())
  await t.run((ctx) =>
    patchProfile(ctx, profileId, { scraperUsageCount: 20, cookiesJson: 'new cookies' }),
  )
  expect(await t.run((ctx) => ctx.db.query('chatWorkerMetadata').unique())).toEqual(before)
  await t.run((ctx) =>
    patchProfile(ctx, profileId, { proxy: 'new:8080', proxyType: 'http', igLoggedIn: false }),
  )
  expect(await t.run((ctx) => ctx.db.query('chatWorkerMetadata').unique())).toMatchObject({
    proxy: 'new:8080',
    enabled: false,
  })
  await t.mutation(internal.profiles.mutations.deleteMobileSessionInternal, { profileId })
  expect(await t.run((ctx) => ctx.db.query('chatWorkerMetadata').unique())).toBeNull()
  expect(await t.run((ctx) => ctx.db.query('scraperProfiles').unique())).toMatchObject({
    scraperReady: false,
  })
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'profile' })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId })
  expect(await t.run((ctx) => ctx.db.query('scraperProfiles').unique())).toBeNull()
})

test('source totals follow add and remove but ignore running state and heartbeats', async () => {
  const t = createConvexTest()
  const listId = await t.mutation(api.leads.createList, { name: 'list' })
  await t.mutation(api.scrapeSources.add, { listId, links: ['first', 'second'] })
  expect(await t.query(api.scrapeSources.summary, { listId })).toEqual({ sources: 2, leads: 0 })
  const source = (await t.query(api.scrapeSources.sources, { listId }))[0]
  await t.run((ctx) => ctx.db.patch(source._id, { running: true, leaseUntil: Date.now() + 1000 }))
  expect(await t.query(api.scrapeSources.summary, { listId })).toEqual({ sources: 2, leads: 0 })
  await t.mutation(api.scrapeSources.remove, { sourceId: source._id })
  await t.mutation(api.scrapeSources.remove, { sourceId: source._id })
  expect(await t.query(api.scrapeSources.summary, { listId })).toEqual({ sources: 1, leads: 0 })
})
