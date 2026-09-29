import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { sanitizeLogValue } from './loggingSanitize.js'

function events(code: string) {
  const raw = execFileSync('bun', ['--eval', code], { cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, LOG_SERVICE: 'logging-test', INTERNAL_API_KEY: 'test-private-secret', COMMIT_SHA: 'test-commit' } })
  return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('concurrent operations emit once, preserve their own context and redact sensitive data', () => {
  const logs = events(`
    import logger, { logOperation, addLogContext, redactLogValues } from './server/shared/logger.ts';
    await Promise.all(['alice', 'bob'].map(profileId => logOperation('test.job', { profileId }, async () => {
      redactLogValues(profileId + '-private-password');
      logger.info({ event: 'job.step', sessionId: 'private-cookie', message: profileId + '-private-password http://user:pass@proxy.test Bearer hidden' });
      await new Promise(resolve => setTimeout(resolve, profileId === 'alice' ? 10 : 1));
      addLogContext({ recordsSaved: profileId === 'alice' ? 2 : 3, apiKey: 'test-private-secret' });
    })));
  `)
  assert.equal(logs.length, 2)
  const alice = logs.find(log => log.profileId === 'alice')
  const bob = logs.find(log => log.profileId === 'bob')
  assert.equal(alice.context.recordsSaved, 2)
  assert.equal(bob.context.recordsSaved, 3)
  assert.notEqual(alice.requestId, bob.requestId)
  assert.equal(alice.environment.commitHash, 'test-commit')
  assert.equal(alice.context.notes[0].sessionId, '[redacted]')
  assert.equal(alice.context.apiKey, '[redacted]')
  assert.ok(!JSON.stringify(logs).includes('user:pass'))
  assert.ok(!JSON.stringify(logs).includes('test-private-secret'))
  assert.ok(!JSON.stringify(logs).includes('private-password'))
})

test('nested failures keep correlation, serialize safe errors and still emit on rejection', () => {
  const logs = events(`
    import { logOperation } from './server/shared/logger.ts';
    await logOperation('parent', { requestId: 'test-request-123', profileId: 'alice' }, async () => {
      await logOperation('child', {}, async () => {
        const error = new Error('failed with Bearer secret-value');
        error.response = { headers: { authorization: 'private-cookie' } };
        throw error;
      });
    }).catch(() => {});
  `)
  assert.equal(logs.length, 2)
  assert.equal(logs[0].requestId, logs[1].requestId)
  assert.equal(logs[0].parentOperationId, logs[1].operationId)
  assert.equal(logs[0].profileId, 'alice')
  for (const log of logs) {
    assert.equal(log.level, 'error')
    assert.equal(log.outcome, 'error')
    assert.equal(log.error.type, 'Error')
    assert.equal(log.error.response, undefined)
    assert.ok(!JSON.stringify(log).includes('secret-value'))
  }
})

test('completion is idempotent and notes are bounded while retaining total counts', () => {
  const logs = events(`
    import logger, { LogScope, runInLogScope } from './server/shared/logger.ts';
    const scope = new LogScope('test.job', {});
    runInLogScope(scope, () => { for (let i = 0; i < 100; i++) logger.info({ event: 'job.step', index: i }); });
    scope.finish('paused'); scope.finish();
  `)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].level, 'info')
  assert.equal(logs[0].outcome, 'paused')
  assert.equal(logs[0].context.notes.length, 20)
  assert.equal(logs[0].context.noteCount, 100)
  assert.equal(logs[0].context.stepCounts['job.step'], 100)
})

test('sanitizer handles cycles, SDK errors and nested credentials without dropping useful counts', () => {
  const input: Record<string, unknown> = { profileCount: 5, sessionToken: 'hidden', OPENROUTER_API_KEY: 'hidden',
    nested: { cookie: 'hidden' }, error: Object.assign(new Error('oops'), { request: { password: 'hidden' } }),
    detail: '{"password":"hidden"}' }
  input.self = input
  const clean = sanitizeLogValue(input) as typeof input
  assert.equal(clean.profileCount, 5)
  assert.equal(clean.self, '[circular]')
  assert.ok(!JSON.stringify(clean).includes('hidden'))
})

test('later background work starts a fresh correlation after its registering scope completes', () => {
  const logs = events(`
    import { LogScope, runInLogScope, logOperation } from './server/shared/logger.ts';
    const scope = new LogScope('startup', {});
    await runInLogScope(scope, async () => {
      scope.finish();
      await logOperation('background.job', {}, async () => {});
    });
  `)
  assert.equal(logs.length, 2)
  assert.notEqual(logs[0].requestId, logs[1].requestId)
  assert.equal(logs[1].parentOperationId, undefined)
})

test('relaying a worker completion preserves its original identity, timing and service', () => {
  const logs = events(`
    import { ingestLogEntry } from './server/shared/logger.ts';
    ingestLogEntry({ id: 'child-event', ts: 123, event: 'browser.session', message: 'browser session',
      level: 'info', source: 'manual-worker', requestId: 'request-123', outcome: 'success',
      environment: { service: 'manual-worker' }, context: { password: 'private-value', outputCount: 4 } });
  `)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].id, 'child-event')
  assert.equal(logs[0].ts, 123)
  assert.equal(logs[0].source, 'manual-worker')
  assert.equal(logs[0].context.password, '[redacted]')
  assert.equal(logs[0].context.outputCount, 4)
})

test('library console output joins one completion event and benign browser banners are informational', () => {
  const logs = events(`
    import { captureConsole } from './server/logs/console.ts';
    import { logOperation } from './server/shared/logger.ts';
    const restore = captureConsole();
    await logOperation('browser.start', {}, async () => {
      console.error('CloakBrowser Pro active (v151) - latest binary, newest patches.');
      console.warn('[cloakbrowser] Incomplete Windows font set');
      console.log('[cloakbrowser] Downloading GeoIP database');
    });
    await logOperation('browser.failure', {}, async () => { console.error(new Error('launch failed')); });
    restore();
  `)
  assert.equal(logs.length, 2)
  assert.equal(logs[0].level, 'info')
  assert.equal(logs[0].context.noteCount, 3)
  assert.equal(logs[1].level, 'error')
  assert.equal(logs[1].error.message, 'launch failed')
})
