import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('HTTP completion events cover parallel, rejected, malformed and failed requests without leaking payloads', () => {
  const raw = execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict';
    import express from 'express';
    import { requestLogging } from './server/logs/middleware.ts';
    import { asyncHandler } from './server/shared/asyncHandler.ts';
    import { addLogContext } from './server/shared/logger.ts';
    const app = express();
    app.use(requestLogging); app.use(express.json());
    app.get('/profiles/:profileId', asyncHandler(async (req, res) => {
      await new Promise(resolve => setTimeout(resolve, req.params.profileId === 'alice' ? 10 : 1));
      res.json({ ok: true });
    }));
    app.get('/rejected', (_req, res) => res.sendStatus(401));
    app.get('/fail', asyncHandler(async () => { throw new Error('failure'); }));
    app.use((error, _req, res, _next) => { addLogContext({ error }); res.sendStatus(error.status || 500); });
    const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
    await Promise.all(['alice', 'bob'].map(async name => {
      const response = await fetch(base + '/profiles/' + name + '?token=secret-query', { headers: { 'x-request-id': 'request-' + name } });
      assert.equal(response.headers.get('x-request-id'), 'request-' + name);
      await response.text();
    }));
    await fetch(base + '/rejected'); await fetch(base + '/fail');
    const malformed = await fetch(base + '/bad', { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'invalid id' }, body: '{"password":"secret-body"' });
    assert.notEqual(malformed.headers.get('x-request-id'), 'invalid id');
    await new Promise(resolve => server.close(resolve));
  `], { cwd: process.cwd(), encoding: 'utf8' })
  const logs = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  assert.equal(logs.length, 5)
  for (const name of ['alice', 'bob']) {
    const log = logs.find(log => log.requestId === `request-${name}`)
    assert.equal(log.profileId, name)
    assert.equal(log.context.path, '/profiles/:profileId')
    assert.equal(log.context.statusCode, 200)
  }
  assert.equal(logs.find(log => log.context.statusCode === 401).outcome, 'rejected')
  assert.equal(logs.find(log => log.context.statusCode === 500).level, 'error')
  assert.equal(logs.find(log => log.context.statusCode === 400).outcome, 'rejected')
  assert.ok(!raw.includes('secret-query'))
  assert.ok(!raw.includes('secret-body'))
})
