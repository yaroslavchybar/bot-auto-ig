import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../convex/_generated/api';
import { createConvexTest } from './helpers';
afterEach(() => vi.unstubAllEnvs());

test('scraper is idle without work and exposes capacity reset and lease expiry', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge');
  const t = createConvexTest();
  const args = { bridgeToken: 'test-bridge' };
  expect(await t.query(api.scraper.work, args)).toEqual({ jobAt: null, jobKey: null, enrichmentKey: null });
  await expect(t.query(api.scraper.work, { bridgeToken: 'wrong' })).rejects.toThrow('Unauthorized');
  const ids = await t.run(async ctx => {
    const profile = await ctx.db.insert('profiles', { name: 'test', using: false, mode: 'direct', createdAt: 0, sessionId: 'test',
      scraperDailyLimit: 10, scraperUsageCount: 10, scraperUsageDate: '2026-09-24' });
    const list = await ctx.db.insert('leadLists', { name: 'leads', createdAt: 0 });
    const job = await ctx.db.insert('scrapeJobs', { username: 'source', listId: list, sinceDate: 0,
      postLimit: 1, status: 'paused', discovered: 0, createdAt: 0, updatedAt: 0 });
    return { profile, job };
  });
  const midnight = Date.parse('2026-09-25T00:00:00Z');
  expect((await t.query(api.scraper.work, args)).jobAt).toBe(midnight);
  await t.run(ctx => ctx.db.patch(ids.profile, { scraperCooldownUntil: midnight + 60_000 }));
  expect((await t.query(api.scraper.work, args)).jobAt).toBe(midnight + 60_000);
  await t.run(ctx => ctx.db.patch(ids.job, { status: 'running', leaseUntil: midnight + 120_000 }));
  expect((await t.query(api.scraper.work, args)).jobAt).toBe(midnight + 120_001);
  await t.run(ctx => ctx.db.patch(ids.job, { status: 'completed' }));
  expect((await t.query(api.scraper.work, args)).jobAt).toBeNull();
  const lead = await t.run(ctx => ctx.db.insert('leads', { username: 'lead', createdAt: 0, dmSent: false, followed: false, enrichmentStatus: 'pending' }));
  expect((await t.query(api.scraper.work, args)).enrichmentKey).toBe(lead);
  await t.run(ctx => ctx.db.patch(lead, { enrichmentStatus: 'ready' }));
  expect((await t.query(api.scraper.work, args)).enrichmentKey).toBeNull();
});

test('maintenance includes only deleting and renaming profiles', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge');
  const t = createConvexTest();
  const args = { bridgeToken: 'test-bridge' };
  const [deleting, renaming] = await t.run(async ctx => {
    await ctx.db.insert('profiles', { name: 'idle', using: false, mode: 'direct', createdAt: 0 });
    return Promise.all([
      ctx.db.insert('profiles', { name: 'delete', using: false, mode: 'direct', createdAt: 0, status: 'deleting' }),
      ctx.db.insert('profiles', { name: 'rename', using: false, mode: 'direct', createdAt: 0, renameFrom: 'old' }),
    ]);
  });
  expect(new Set(await t.query(api.profiles.queries.maintenanceWork, args))).toEqual(new Set([deleting, renaming]));
  await t.run(async ctx => { await ctx.db.delete(deleting); await ctx.db.patch(renaming, { renameFrom: undefined }); });
  expect(await t.query(api.profiles.queries.maintenanceWork, args)).toEqual([]);
  expect(await t.query(api.profiles.queries.chatWorkerProfiles, args)).toEqual([]);
});
