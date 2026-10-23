import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { sanitizeLogValue } from './loggingSanitize.js'
import { isLogEntry } from './loggingTypes.js'

test('inline image data is redacted even when a provider echoes a truncated image URL', () => {
  const clean = sanitizeLogValue({ detail: 'Rejected data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ', count: 1 })
  assert.deepEqual(clean, { detail: 'Rejected [redacted image]', count: 1 })
})

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
      logger.info({ event: 'job.step', instagramSessionId: 'private-cookie', message: profileId + '-private-password http://user:pass@proxy.test Bearer hidden' });
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
  assert.equal(alice.context.notes[0].instagramSessionId, '[redacted]')
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

test('bounded cookie redactions preserve credentials and remain inherited by child operations', () => {
  const logs = events(`
    import { logOperation, redactLogValues, redactCookieLogValues } from './server/shared/logger.ts';
    await logOperation('parent', {}, async () => {
      redactLogValues('protected-password', 'protected-authenticator', 'protected-proxy');
      redactCookieLogValues(...Array.from({length:25}, (_, i) => 'cookie-value-' + i + '-end'));
      // Repeated cookie registrations use the same bounded pool, independently of credentials.
      redactCookieLogValues('cookie-value-25-end');
      await logOperation('child', {}, async () => {
        throw new Error('protected-password protected-authenticator protected-proxy cookie-value-25-end cookie-value-6-end cookie-value-5-end');
      });
    }).catch(() => {});
  `)
  assert.equal(logs.length, 2)
  for (const log of logs) {
    assert.equal(log.outcome, 'error')
    for (const value of ['protected-password', 'protected-authenticator', 'protected-proxy', 'cookie-value-25-end', 'cookie-value-6-end'])
      assert.ok(!log.error.message.includes(value))
    assert.ok(log.error.message.includes('cookie-value-5-end'), 'only cookie values use the cookie pool limit')
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

test('handled diagnostics emit immediately and survive later notes without failing the operation', () => {
  const logs = events(`
    import logger, { logOperation, logDiagnostic, redactLogValues, redactCookieLogValues } from './server/shared/logger.ts';
    await logOperation('automation.profile_session', { profileId: 'alice', profileName: 'Alice', automationId: 'routine-1' }, async scope => {
      redactLogValues('account-password');
      redactCookieLogValues('private-cookie-value');
      for (let index = 0; index < 7; index++) logDiagnostic({ event: 'automation.ui_failure', index,
        error: new Error('account-password private-cookie-value'), expectedSelector: 'account-password' });
      if (scope.failed) throw new Error('A recoverable diagnostic must not fail the session');
      for (let index = 0; index < 30; index++) logger.info({ event: 'routine.step', index });
    });
  `)
  assert.equal(logs.length, 8)
  const completion = logs.at(-1)
  assert.equal(completion.event, 'automation.profile_session')
  assert.equal(completion.outcome, 'success')
  assert.equal(completion.level, 'info')
  assert.equal(completion.context.notes.length, 20)
  assert.equal(completion.context.diagnosticCount, 7)
  assert.deepEqual(completion.context.diagnostics.map((entry: { index: number }) => entry.index), [2, 3, 4, 5, 6])
  for (const diagnostic of logs.slice(0, -1)) {
    assert.equal(diagnostic.level, 'error')
    assert.equal(diagnostic.outcome, 'error')
    assert.equal(diagnostic.parentOperationId, completion.operationId)
    assert.equal(diagnostic.requestId, completion.requestId)
    assert.equal(diagnostic.profileName, 'Alice')
    assert.equal(diagnostic.automationId, 'routine-1')
  }
  assert.equal(new Set(logs.map(log => log.operationId)).size, logs.length)
  assert.ok(logs.every(isLogEntry))
  assert.ok(!JSON.stringify(logs).includes('account-password'))
  assert.ok(!JSON.stringify(logs).includes('private-cookie-value'))
})

test('concurrent diagnostic summaries stay isolated and completed scopes are not reused', () => {
  const logs = events(`
    import { logOperation, logDiagnostic } from './server/shared/logger.ts';
    await Promise.all(['alice', 'bob'].map(profileId => logOperation('job', { profileId }, async () => {
      await Promise.resolve();
      logDiagnostic({ event: 'automation.ui_failure', action: profileId });
    })));
    await logOperation('finished', {}, async scope => {
      scope.finish();
      logDiagnostic({ event: 'automation.ui_failure', action: 'late' });
    });
  `)
  for (const profileId of ['alice', 'bob']) {
    const completion = logs.find(log => log.event === 'job' && log.profileId === profileId)
    const diagnostic = logs.find(log => log.event === 'automation.ui_failure' && log.profileId === profileId)
    assert.equal(completion.context.diagnosticCount, 1)
    assert.equal(completion.context.diagnostics[0].action, profileId)
    assert.equal(diagnostic.parentOperationId, completion.operationId)
  }
  const finished = logs.find(log => log.event === 'finished'), late = logs.at(-1)
  assert.equal(late.context.action, 'late')
  assert.equal(late.parentOperationId, undefined)
  assert.notEqual(late.requestId, finished.requestId)
})

test('invalid request IDs cannot break worker event recognition or parent correlation', () => {
  const logs = events(`
    import logger, { logOperation, currentRequestId } from './server/shared/logger.ts';
    process.env.LOG_REQUEST_ID = 'invalid id';
    if (currentRequestId() !== undefined) throw new Error('invalid inherited request ID');
    logger.info({ event: 'standalone', requestId: 'invalid id' });
    await logOperation('parent', { requestId: 'parent-request-123' }, async () => {
      await logOperation('child', { requestId: 'invalid id' }, async () => {});
    });
    await logOperation('fresh', { requestId: 123 }, async () => {});
  `)
  assert.ok(logs.every(isLogEntry))
  assert.equal(logs[1].requestId, 'parent-request-123')
  assert.equal(logs[2].requestId, 'parent-request-123')
  assert.notEqual(logs[0].requestId, logs[3].requestId)
})

test('step counts treat object prototype names as ordinary event names', () => {
  const [log] = events(`
    import logger, { logOperation } from './server/shared/logger.ts';
    await logOperation('test.job', {}, async () => {
      for (const event of ['constructor', 'toString', '__proto__', '__proto__']) logger.info({ event });
    });
  `)
  assert.deepEqual(log.context.stepCounts, { constructor: 1, toString: 1, ['__proto__']: 2 })
})

test('sanitizer handles cycles, SDK errors and nested credentials without dropping useful counts', () => {
  const input: Record<string, unknown> = { profileCount: 5, sessionToken: 'hidden', OPENROUTER_API_KEY: 'hidden',
    nested: { cookie: 'hidden', sessionid: 'hidden', instagramSessionId: 'hidden' }, error: Object.assign(new Error('oops'), { request: { password: 'hidden' } }),
    detail: '{"password":"hidden","instagramSessionId":"hidden"}' }
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
