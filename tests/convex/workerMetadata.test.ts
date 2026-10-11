import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { patchProfile } from '../../convex/workerMetadata'
import { createConvexTest } from './helpers'

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

test('startup backfills existing worker metadata and source totals without resetting progress', async () => {
  vi.useFakeTimers()
  vi.stubEnv('INTERNAL_API_KEY', 'bridge')
  try {
    const t = createConvexTest()
    const { profileId, listId } = await t.run(async ctx => {
      const profileId = await ctx.db.insert('profiles', {
        name: 'old', createdAt: 0, using: false, igLoggedIn: true,
        sessionId: 'browser', cookiesJson: 'large cookie payload', scraperUsageDate: '2026-10-11', scraperUsageCount: 15,
      })
      const storageId = await ctx.storage.store(new Blob(['session']))
      await ctx.db.insert('chatSessions', { profileId, storageId, token: 'token' })
      await ctx.db.insert('chatMemberships', { profileId })
      const listId = await ctx.db.insert('leadLists', { name: 'old list', createdAt: 0 })
      await ctx.db.insert('scrapeSources', { listId, username: 'source', enabled: true, running: false, nextCheckAt: 0, postCount: 0, discovered: 17, createdAt: 0 })
      return { profileId, listId }
    })
    await t.mutation(internal.workerMetadata.initialize, {})
    await t.mutation(internal.workerMetadata.initialize, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const scraper = await t.run(ctx => ctx.db.query('scraperProfiles').unique())
    expect(scraper).toMatchObject({ profileId, scraperReady: true, scraperUsageCount: 15 })
    expect(scraper).not.toHaveProperty('cookiesJson')
    expect(await t.query(api.profiles.queries.chatWorkerContexts, { bridgeToken: 'bridge', subscriptionId: 'worker' }))
      .toMatchObject([{ profileId, enabled: true, token: 'token' }])
    expect(await t.query(api.scrapeSources.summary, { listId })).toEqual({ sources: 1, leads: 0 })
    // Opening an already initialized list must preserve both counts.
    await t.mutation(api.leads.ensureCount, { listId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await t.query(api.scrapeSources.summary, { listId })).toEqual({ sources: 1, leads: 0 })
    await t.run(ctx => patchProfile(ctx, profileId, { using: true, status: 'running' }))
    expect(await t.query(api.scraper.work, { bridgeToken: 'bridge' })).toMatchObject({ taskAt: null, blockedProfileIds: [profileId] })
    await t.run(ctx => patchProfile(ctx, profileId, { using: false, status: 'idle' }))
    expect(await t.query(api.scraper.work, { bridgeToken: 'bridge' })).toMatchObject({ taskAt: 0, blockedProfileIds: [] })
  } finally { vi.useRealTimers() }
})

test('quota and cookies cannot change chat metadata, while proxy, login and session changes do', async () => {
  const t = createConvexTest()
  const profile = await t.mutation(api.profiles.mutations.create, { name: 'profile' })
  const profileId = profile!._id
  await t.mutation(api.profiles.mutations.setIgState, { profileId, igLoggedIn: true })
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['session'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, storageId, token: 'token' })
  const before = await t.run(ctx => ctx.db.query('chatWorkerMetadata').unique())
  await t.run(ctx => patchProfile(ctx, profileId, { scraperUsageCount: 20, cookiesJson: 'new cookies' }))
  expect(await t.run(ctx => ctx.db.query('chatWorkerMetadata').unique())).toEqual(before)
  await t.run(ctx => patchProfile(ctx, profileId, { proxy: 'new:8080', proxyType: 'http', igLoggedIn: false }))
  expect(await t.run(ctx => ctx.db.query('chatWorkerMetadata').unique())).toMatchObject({ proxy: 'new:8080', enabled: false })
  await t.mutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId })
  expect(await t.run(ctx => ctx.db.query('chatWorkerMetadata').unique())).toBeNull()
  expect(await t.run(ctx => ctx.db.query('scraperProfiles').unique())).toMatchObject({ scraperReady: false })
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'profile' })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId })
  expect(await t.run(ctx => ctx.db.query('scraperProfiles').unique())).toBeNull()
})

test('batched enrichment keeps checkpoints, availability, errors and wakeup transitions correct', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'bridge')
  const t = createConvexTest()
  const [first, second] = await t.run(async ctx => Promise.all(['first', 'second'].map(username =>
    ctx.db.insert('leads', { username, createdAt: 0, enrichmentStatus: 'pending', followed: false, dmSent: false }))))
  await t.run(async ctx => {
    const listId = await ctx.db.insert('leadLists', { name: 'list', createdAt: 0 })
    await ctx.db.insert('leadMemberships', { listId, leadId: first, leadCreatedAt: 0, available: false })
  })
  await t.mutation(internal.workerMetadata.initialize, {})
  const read = () => t.query(api.scraper.enrichmentWork, { bridgeToken: 'bridge' })
  expect(await read()).toEqual({ pending: true })
  await expect(t.query(api.scraper.enrichmentWork, { bridgeToken: 'wrong' })).rejects.toThrow('Unauthorized')
  const signal = await t.run(ctx => ctx.db.query('enrichmentWork').unique())
  await t.mutation(internal.scraper.saveEnrichmentBatch, { entries: [{ leadId: first, description: 'saved description' }] })
  expect(await t.run(ctx => ctx.db.query('enrichmentWork').unique())).toEqual(signal)
  await t.mutation(internal.scraper.saveEnrichmentBatch, { entries: [{ leadId: first, classification: 'male' }, { leadId: second, error: true }] })
  expect(await t.run(ctx => ctx.db.get(first))).toMatchObject({ profilePicDescription: 'saved description', classification: 'male', enrichmentStatus: 'ready' })
  expect(await t.run(ctx => ctx.db.query('leadMemberships').unique())).toMatchObject({ leadId: first, available: true })
  expect(await read()).toEqual({ pending: false })
  // A delayed/retried checkpoint must not undo a completed classification.
  await t.mutation(internal.scraper.saveEnrichmentBatch, { entries: [{ leadId: first, error: true }] })
  expect(await t.run(ctx => ctx.db.get(first))).toMatchObject({ enrichmentStatus: 'ready' })
  await t.mutation(api.scraper.retryEnrichment, {})
  expect(await read()).toEqual({ pending: true })
  await expect(t.mutation(internal.scraper.saveEnrichmentBatch, { entries: Array.from({ length: 11 }, () => ({ leadId: first, error: true as const })) })).rejects.toThrow('Invalid enrichment batch')
})

test('source totals follow add and remove but ignore running state and heartbeats', async () => {
  const t = createConvexTest()
  const listId = await t.mutation(api.leads.createList, { name: 'list' })
  await t.mutation(api.scrapeSources.add, { listId, links: ['first', 'second'] })
  expect(await t.query(api.scrapeSources.summary, { listId })).toEqual({ sources: 2, leads: 0 })
  const source = (await t.query(api.scrapeSources.sources, { listId }))[0]
  await t.run(ctx => ctx.db.patch(source._id, { running: true, leaseUntil: Date.now() + 1000 }))
  expect(await t.query(api.scrapeSources.summary, { listId })).toEqual({ sources: 2, leads: 0 })
  await t.mutation(api.scrapeSources.remove, { sourceId: source._id })
  await t.mutation(api.scrapeSources.remove, { sourceId: source._id })
  expect(await t.query(api.scrapeSources.summary, { listId })).toEqual({ sources: 1, leads: 0 })
})
