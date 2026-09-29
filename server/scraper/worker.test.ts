import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('scraper preserves source, resumes saved posts, and cools down mobile 429s', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict';
    import { mock } from 'bun:test';
    import { IgResponseError } from 'instagram-private-api';

    let mobileError;
    let mobileReads = 0;
    let apifyReads = 0;
    let likerReads = 0;
    let job;
    let exhausted = false;
    const calls = [];
    const runs = [];
    const warnings = [];
    const post = { id: '1', code: 'one' };
    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetById: async () => ({ id: 'profile', name: 'profile', using: false, sessionId: 'test' }),
      scraperRequest: async (operation, args) => {
        calls.push({ operation, ...args });
        if (operation === 'claim') return job;
        if (operation === 'checkpoint') return { limitExhausted: exhausted };
        if (operation === 'batch') return { added: 1, processed: args.likers.length, limitExhausted: exhausted };
      },
    }));
    mock.module('./server/shared/logger.ts', () => ({ default: {
      warn: (...args) => warnings.push(args), error: () => {},
    } }));
    mock.module('./server/chat/instagram.ts', () => ({ InstagramChat: class {
      static load = async () => ({ recentProfilePosts: async (_username, _since, _limit, onPage) => {
        mobileReads++;
        await onPage();
        if (mobileError) throw mobileError;
        return [post];
      } });
    } }));
    mock.module('./server/scraper/apify.ts', () => ({ recentPosts: async () => { apifyReads++; return [post]; } }));
    mock.module('./server/scraper/classify.ts', () => ({ openRouterClient: () => ({}), classifyAccount: async () => 'male' }));
    mock.module('./server/scraper/picture.ts', () => ({ describePicture: async () => '', validPictureUrl: () => '' }));
    mock.module('./server/shared/reactiveWork.ts', () => ({ reactiveWork: options => {
      runs.push(options.run);
      return { update() {}, stop() {} };
    } }));
    mock.module('./server/shared/convexRealtime.ts', () => ({ watchScraperWork: () => ({
      initial: Promise.resolve(), unsubscribe() {},
    }) }));
    const { InstagramHttp } = await import('./server/scraper/instagram.ts');
    InstagramHttp.prototype.likers = async () => { likerReads++; return [{ igId: '11', username: 'lead' }]; };
    const { startScraperWorker } = await import('./server/scraper/worker.ts');
    const stop = startScraperWorker();
    const tick = async (overrides = {}) => {
      calls.length = 0;
      job = { _id: 'job', username: 'source', profileId: 'profile', runId: 'run', sinceDate: 0, postLimit: 2, ...overrides };
      await runs[0]();
      return calls.find(call => call.operation === 'finish');
    };

    assert.equal((await tick()).status, 'completed');
    assert.ok(calls.some(call => call.operation === 'checkpoint' && !('posts' in call) && !('postIndex' in call)));
    assert.ok(calls.some(call => call.postsFromApify === false));
    assert.equal(apifyReads, 0);

    mobileError = new Error('no mobile session');
    assert.equal((await tick()).status, 'completed');
    assert.ok(calls.some(call => call.postsFromApify === true));
    assert.equal(apifyReads, 1);
    const readsBeforeResume = mobileReads;
    assert.equal((await tick({ posts: [post], postsFromApify: true })).status, 'completed');
    assert.equal(mobileReads, readsBeforeResume);
    assert.equal(apifyReads, 1);

    mobileError = undefined;
    exhausted = true;
    assert.equal((await tick({ posts: [post, { id: '2', code: 'two' }] })).status, 'paused');
    assert.ok(calls.some(call => call.postIndex === 1));
    assert.equal((await tick({ posts: [post] })).status, 'completed');

    exhausted = false;
    mobileError = new IgResponseError({ statusCode: 429, statusMessage: 'Too Many Requests',
      headers: { 'retry-after': '3600' }, body: { message: 'slow down' },
      request: { method: 'GET', uri: { path: '/feed/' }, headers: { cookie: 'secret-cookie' } },
    });
    const likersBefore429 = likerReads;
    assert.equal((await tick()).status, 'paused');
    assert.equal(apifyReads, 1);
    assert.equal(likerReads, likersBefore429);
    assert.ok(calls.some(call => call.operation === 'cooldown' && call.retryAfterMs === 3600000));
    assert.ok(!JSON.stringify(warnings).includes('secret-cookie'));
    stop();
  `], { cwd: process.cwd(), stdio: 'pipe', timeout: 60_000 });
});
