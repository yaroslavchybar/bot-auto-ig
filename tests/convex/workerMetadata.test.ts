import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { patchProfile } from '../../convex/workerMetadata'
import { createConvexTest } from './helpers'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

test('scraper metadata follows browser cookie availability and proxy changes',async()=>{
 const t=createConvexTest();const profile=(await t.mutation(api.profiles.mutations.create,{name:'profile'}))!;
 const profileId=profile._id
 expect(await t.run(ctx=>ctx.db.query('scraperProfiles').unique())).toMatchObject({scraperReady:false})
 await t.run(ctx=>patchProfile(ctx,profileId,{instagramSessionId:'cookie',proxy:'new:8080',proxyType:'http'}))
 expect(await t.run(ctx=>ctx.db.query('scraperProfiles').unique())).toMatchObject({scraperReady:true,proxy:'new:8080'})
 await t.run(ctx=>patchProfile(ctx,profileId,{instagramSessionId:undefined}))
 expect(await t.run(ctx=>ctx.db.query('scraperProfiles').unique())).toMatchObject({scraperReady:false})
 await t.mutation(internal.profiles.mutations.beginDeleteInternal,{name:'profile'})
 await t.mutation(internal.profiles.mutations.removeByIdInternal,{profileId})
 expect(await t.run(ctx=>ctx.db.query('scraperProfiles').unique())).toBeNull()
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
