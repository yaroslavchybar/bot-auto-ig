import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('image-processing logs correlation, counts and failures while preserving responses and the queue', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict';
    import path from 'node:path';
    import { promises as fs } from 'node:fs';
    delete process.env.SPOOFER_DATA_ROOT;
    const logs = [];
    console.info = console.error = raw => logs.push(JSON.parse(raw));
    let failed = false;
    fs.stat = async () => ({ isFile: () => true });
    const run = async () => {
      if (failed) throw new Error('binary failed');
      return { outputs: [{ name: 'one.jpg' }], failures: [] };
    };
    const { handleRequest } = await import('./tools/spoofer/service.ts');
    const server = { timeout() {} };
    const source = path.join(path.resolve('/app/data/model-content'), 'model123', 'posts', '11111111-1111-4111-8111-111111111111', 'source.jpg');
    const send = () => handleRequest(new Request('http://spoofer/variants', {
      method: 'POST', headers: { 'x-request-id': 'test-request-123' }, body: JSON.stringify({ source }),
    }), server, run);
    const success = await send();
    assert.equal(success.status, 200, JSON.stringify(await success.clone().json()));
    assert.equal(success.headers.get('x-request-id'), 'test-request-123');
    assert.equal((await success.json()).outputs.length, 1);
    assert.equal(logs[0].context.modelId, 'model123');
    assert.equal(logs[0].context.outputCount, 1);
    assert.equal(logs[0].context.failureCount, 0);
    assert.equal(logs[0].source, 'spoofer');
    failed = true;
    assert.equal((await send()).status, 422);
    assert.equal(logs[1].level, 'error');
    assert.equal(logs[1].outcome, 'error');
    failed = false;
    assert.equal((await send()).status, 200);
    const malformed = await handleRequest(new Request('http://spoofer/variants', { method: 'POST', body: '{"password":"private-value"' }), server);
    assert.equal(malformed.status, 422);
    assert.equal(logs[3].outcome, 'rejected');
    assert.equal(logs[3].error.message, 'Invalid request JSON');
    assert.equal((await handleRequest(new Request('http://spoofer/health'), server)).status, 200);
    assert.equal((await handleRequest(new Request('http://spoofer/missing'), server)).status, 404);
    assert.equal(logs.length, 6);
    assert.ok(!JSON.stringify(logs).includes('private-value'));
    assert.ok(!JSON.stringify(logs).includes(source));
  `], { cwd: process.cwd(), stdio: 'pipe', timeout: 10_000 })
})
