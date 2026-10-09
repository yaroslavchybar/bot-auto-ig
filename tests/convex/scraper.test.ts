import { expect, test, vi } from 'vite-plus/test';
import { api, internal } from '../../convex/_generated/api';
import { createConvexTest, seedProfile } from './helpers';

test('the jobs UI receives post counts without large worker checkpoints', async () => {
  const t = createConvexTest();
  const ids = await t.run(async ctx => {
    const listId = await ctx.db.insert('leadLists', { name: 'leads', createdAt: 0 });
    const jobId = await ctx.db.insert('scrapeJobs', {
      username: 'source', listId, status: 'paused', sinceDate: 0, postLimit: 5000,
      posts: Array.from({ length: 5000 }, (_, i) => ({ id: String(i), code: `post${i}` })),
      discovered: 42, postIndex: 1000, runId: 'worker-run', error: 'Daily limit reached',
      createdAt: 0, updatedAt: 0,
    });
    return { listId, jobId };
  });
  const jobs = await t.query(api.scraper.jobs, {});
  expect(jobs).toEqual([{
    _id: ids.jobId, username: 'source', listId: ids.listId, status: 'paused',
    discovered: 42, sinceDate: 0, postLimit: 5000, error: 'Daily limit reached', postCount: 5000,
  }]);
  expect(JSON.stringify(jobs).length).toBeLessThan(1000);
  expect((await t.run(ctx => ctx.db.get(ids.jobId)))?.posts).toHaveLength(5000);
});

test('mobile-only scraping accounts are ready and claim jobs until their session needs reconnecting', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge');
  try {
    const t = createConvexTest();
    const ids = await t.run(async ctx => {
      const profileId = await ctx.db.insert('profiles', {
        name: 'mobile-only', using: false, mode: 'direct', createdAt: 0,
      });
      const storageId = await ctx.storage.store(new Blob(['{}']));
      const sessionId = await ctx.db.insert('chatSessions', { profileId, storageId, token: 'mobile-token' });
      const listId = await ctx.db.insert('leadLists', { name: 'leads', createdAt: 0 });
      const jobId = await ctx.db.insert('scrapeJobs', {
        username: 'source', listId, status: 'queued', sinceDate: 0, postLimit: 1,
        discovered: 0, createdAt: 0, updatedAt: 0,
      });
      return { profileId, sessionId, jobId };
    });
    expect((await t.query(api.scraper.accounts, {}))[0]).toMatchObject({ ready: true, dailyLimit: 1000 });
    expect((await t.query(api.scraper.work, { bridgeToken: 'test-bridge' })).jobAt).toBe(0);
    expect(await t.mutation(internal.scraper.claimNext, {})).toMatchObject({ profileId: ids.profileId });
    await t.run(async ctx => {
      await ctx.db.patch(ids.jobId, { status: 'queued', runId: undefined, leaseUntil: undefined });
      await ctx.db.patch(ids.sessionId, { reconnectRequired: true });
    });
    expect((await t.query(api.scraper.accounts, {}))[0]?.ready).toBe(false);
    expect((await t.query(api.scraper.work, { bridgeToken: 'test-bridge' })).jobAt).toBeNull();
    expect(await t.mutation(internal.scraper.claimNext, {})).toBeNull();
    // Browser cookies remain usable even if the mobile session is disconnected.
    await t.run(ctx => ctx.db.patch(ids.profileId, { sessionId: 'browser-cookie' }));
    expect((await t.query(api.scraper.accounts, {}))[0]?.ready).toBe(true);
    expect(await t.mutation(internal.scraper.claimNext, {})).toMatchObject({ profileId: ids.profileId });
  } finally {
    vi.unstubAllEnvs();
  }
});

async function runningJob(options: { limit?: number | null; used?: number; fromApify?: boolean } = {}) {
  const t = createConvexTest();
  const ids = await t.run(async ctx => {
    const profileId = await ctx.db.insert('profiles', {
      name: 'scraper', using: false, mode: 'direct', createdAt: 0, sessionId: 'test',
      scraperDailyLimit: options.limit, scraperUsageCount: options.used ?? 0,
      scraperUsageDate: new Date().toISOString().slice(0, 10),
      scraperRateLimitCount: 2, scraperCooldownUntil: Date.now() - 1,
    });
    const listId = await ctx.db.insert('leadLists', { name: 'leads', createdAt: 0 });
    const jobId = await ctx.db.insert('scrapeJobs', {
      username: 'source', listId, profileId, runId: 'run', status: 'running',
      sinceDate: 0, postLimit: 2, posts: [{ id: '1', code: 'one' }, { id: '2', code: 'two' }],
      postsFromApify: options.fromApify, discovered: 0, createdAt: 0, updatedAt: 0,
    });
    return { profileId, jobId };
  });
  return { t, ...ids, checkpoint: { jobId: ids.jobId, runId: 'run' } };
}

test('native post checkpoints charge once, reject backwards progress, and renew the lease', async () => {
  const { t, profileId, jobId, checkpoint } = await runningJob({ fromApify: false });
  await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 });
  await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 });
  expect((await t.run(ctx => ctx.db.get(profileId)))?.scraperUsageCount).toBe(1);
  await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 2 });
  expect((await t.run(ctx => ctx.db.get(profileId)))?.scraperUsageCount).toBe(2);
  await expect(t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 }))
    .rejects.toThrow('Invalid post checkpoint');
  await expect(t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 3 }))
    .rejects.toThrow('Invalid post checkpoint');
  expect((await t.run(ctx => ctx.db.get(jobId)))?.postIndex).toBe(2);
  expect((await t.run(ctx => ctx.db.get(jobId)))?.leaseUntil).toBeGreaterThan(Date.now());
});

test('a post checkpoint cannot exceed capacity already consumed by the liker batch', async () => {
  const { t, profileId, checkpoint } = await runningJob({ limit: 10, used: 9, fromApify: false });
  expect(await t.mutation(internal.scraper.saveBatch, { ...checkpoint, likers: [
    { igId: '11', username: 'first' }, { igId: '12', username: 'second' },
  ] })).toEqual({ added: 1, processed: 1, limitExhausted: true });
  expect(await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 }))
    .toEqual({ limitExhausted: true });
  await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 });
  expect((await t.run(ctx => ctx.db.get(profileId)))?.scraperUsageCount).toBe(10);
});

test.each([true, undefined])('Apify and unmarked saved posts do not charge post usage (%s)', async fromApify => {
  const { t, profileId, checkpoint } = await runningJob({ fromApify, used: 3 });
  await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 });
  const profile = await t.run(ctx => ctx.db.get(profileId));
  expect(profile?.scraperUsageCount).toBe(3);
  // Liker requests use the account regardless of where its post list came from.
  expect(profile?.scraperRateLimitCount).toBe(0);
  expect(profile?.scraperCooldownUntil).toBeUndefined();
});

test('a source flag saved with the advancing checkpoint controls its charge', async () => {
  const { t, profileId, checkpoint } = await runningJob();
  await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postsFromApify: false, postIndex: 1 });
  expect((await t.run(ctx => ctx.db.get(profileId)))?.scraperUsageCount).toBe(1);
});

test('heartbeat and repeated post checkpoints do not clear a later account cooldown', async () => {
  const { t, profileId, checkpoint } = await runningJob({ fromApify: false });
  await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 });
  await t.mutation(internal.scraper.cooldownAccount, { profileId });
  const before = await t.run(ctx => ctx.db.get(profileId));
  await t.mutation(internal.scraper.checkpoint, checkpoint);
  await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 });
  const after = await t.run(ctx => ctx.db.get(profileId));
  expect(after?.scraperCooldownUntil).toBe(before?.scraperCooldownUntil);
  expect(after?.scraperRateLimitCount).toBe(before?.scraperRateLimitCount);
  expect(after?.scraperUsageCount).toBe(1);
});

test('daily limits can be set and cleared while preserving the new-profile default', async () => {
  const t = createConvexTest();
  const profile = (await seedProfile(t))!;
  expect(profile.scraperDailyLimit).toBe(1000);
  await t.mutation(api.scraper.setDailyLimit, { profileId: profile._id, limit: 5 });
  expect((await t.query(api.scraper.accounts, {}))[0]?.dailyLimit).toBe(5);
  await t.mutation(api.scraper.setDailyLimit, { profileId: profile._id });
  expect((await t.query(api.scraper.accounts, {}))[0]?.dailyLimit).toBeUndefined();
  expect((await t.run(ctx => ctx.db.get(profile._id)))?.scraperDailyLimit).toBeNull();
  await expect(t.mutation(api.scraper.setDailyLimit, { profileId: profile._id, limit: 0 }))
    .rejects.toThrow('Limit must');
});

test('accounts without a saved limit display and enforce the 1000 daily default', async () => {
  const { t, profileId, checkpoint } = await runningJob({ used: 999, fromApify: false });
  expect((await t.query(api.scraper.accounts, {}))[0]?.dailyLimit).toBe(1000);
  expect(await t.mutation(internal.scraper.saveBatch, {
    ...checkpoint, likers: [{ igId: '11', username: 'first' }, { igId: '12', username: 'second' }],
  })).toEqual({ added: 1, processed: 1, limitExhausted: true });
  expect(await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 }))
    .toEqual({ limitExhausted: true });
  expect((await t.run(ctx => ctx.db.get(profileId)))?.scraperUsageCount).toBe(1000);
  await t.mutation(internal.scraper.finish, { ...checkpoint, status: 'paused' });
  expect(await t.mutation(internal.scraper.claimNext, {})).toBeNull();
  await t.run(ctx => ctx.db.patch(profileId, { scraperUsageDate: '2000-01-01' }));
  expect(await t.mutation(internal.scraper.claimNext, {})).toMatchObject({ profileId });
});

test('explicitly unlimited profiles can save batches and claim work after high usage', async () => {
  const { t, profileId, jobId, checkpoint } = await runningJob({ limit: null, used: 100000, fromApify: false });
  const result = await t.mutation(internal.scraper.saveBatch, {
    ...checkpoint, likers: [{ igId: '11', username: 'first' }],
  });
  expect(result).toEqual({ added: 1, processed: 1, limitExhausted: false });
  await t.mutation(internal.scraper.finish, { ...checkpoint, status: 'paused' });
  expect(await t.mutation(internal.scraper.claimNext, {})).toMatchObject({ _id: jobId, profileId });
});

test('post charges reset at UTC midnight and reject stale runs', async () => {
  const { t, profileId, checkpoint } = await runningJob({ limit: 10, used: 10, fromApify: false });
  await t.run(ctx => ctx.db.patch(profileId, { scraperUsageDate: '2000-01-01' }));
  await expect(t.mutation(internal.scraper.checkpoint, { ...checkpoint, runId: 'old', postIndex: 1 }))
    .rejects.toThrow('no longer active');
  expect(await t.mutation(internal.scraper.checkpoint, { ...checkpoint, postIndex: 1 }))
    .toEqual({ limitExhausted: false });
  expect((await t.run(ctx => ctx.db.get(profileId)))?.scraperUsageCount).toBe(1);
});
