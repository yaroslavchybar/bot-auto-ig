import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

for (const scenario of ['stop', 'crash', 'startup failure', 'stop during launch', 'stop during navigation', 'budget lost during launch', 'cleanup failure', 'save failure']) {
test(`browser cleanup: ${scenario}`, () => {
  // Isolate module mocks and process signal handlers from other tests.
  const output = execFileSync('bun', ['--eval', `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'
    import { EventEmitter } from 'node:events'

    const scenario = ${JSON.stringify(scenario)}
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-shutdown-'))
    const events = []
    const cookies = [{ name: 'sessionid', value: 'test-session', domain: '.instagram.com', path: '/' }]
    const context = new EventEmitter()
    let loseBudget
    let closed = false
    context.pages = () => [{
      url: () => ['startup failure', 'stop during navigation'].includes(scenario) ? 'about:blank' : 'https://www.instagram.com/',
      goto: async () => {
        if (scenario === 'stop during navigation') {
          await new Promise(resolve => {
            context.once('close', resolve)
            process.emit('SIGTERM')
          })
        }
        throw new Error('Navigation failed')
      },
    }]
    context.cookies = async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      assert.equal(closed, false, 'browser must stay open while reading cookies')
      events.push('read')
      return cookies
    }
    context.close = async () => {
      closed = true
      events.push('close')
      context.emit('close')
    }
    mock.module('camoufox-js', () => ({ Camoufox: async options => {
      if (scenario === 'stop during launch') process.emit('SIGTERM')
      if (scenario === 'budget lost during launch') loseBudget()
      // Model Playwright's default competing shutdown handler.
      for (const signal of ['SIGINT', 'SIGTERM']) {
        if (options['handle' + signal] !== false)
          process.once(signal, () => { void context.close() })
      }
      return context
    } }))
    mock.module('fingerprint-generator', () => ({
      FingerprintGenerator: class { getFingerprint() { return { fingerprint: { screen: {} } } } },
    }))
    mock.module('./server/shared/utils.ts', () => ({ resolveProjectRoot: () => root }))
    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetByName: async () => ({ name: 'test' }),
      profilesUpdateByName: async (name, update) => {
        if (scenario === 'save failure') throw new Error('Database unavailable')
        await new Promise(resolve => setTimeout(resolve, 10))
        assert.equal(closed, false, 'browser must stay open until persistence completes')
        assert.equal(name, 'test')
        assert.deepEqual(JSON.parse(update.cookiesJson), cookies)
        assert.equal(update.sessionId, 'test-session')
        events.push('saved')
      },
    }))
    mock.module('./server/browser/budget.ts', () => ({ acquireBrowserSlot: async (_signal, _address, onLost) => {
      loseBudget = onLost
      return () => {
        assert.equal(fs.existsSync(path.join(root, 'data/profiles/test/worker.lock')), false)
        events.push('slot')
      }
    } }))
    mock.module('./server/browser/proxy.ts', () => ({
      prepareBrowserProxy: async () => ({ proxy: undefined, close: async () => {
        events.push('proxy')
        if (scenario === 'cleanup failure') throw new Error('Proxy cleanup failed')
      } }),
    }))
    mock.module('./server/browser/display.ts', () => ({ allocateDisplay: async () => ({
      display: ':100', close: async () => { events.push('display') },
    }) }))
    try {
      const { openCamoufoxSession } = await import('./server/browser/camoufox.ts')
      if (['startup failure', 'stop during launch', 'stop during navigation', 'budget lost during launch'].includes(scenario)) {
        const expected = ['startup failure', 'stop during navigation'].includes(scenario) ? /Navigation failed/
          : scenario === 'stop during launch' ? /Browser worker stopped/ : /budget disconnected/
        await assert.rejects(openCamoufoxSession('test'), expected)
        assert.deepEqual(events, ['close', 'proxy', 'display', 'slot'])
      } else {
        const session = await openCamoufoxSession('test')
        if (scenario === 'crash') {
          closed = true
          context.emit('close')
          await session.closed
          assert.deepEqual(events, ['proxy', 'display', 'slot'])
        } else {
          process.emit('SIGTERM')
          assert.equal(session.close(), session.close())
          if (scenario === 'cleanup failure') {
            await assert.rejects(session.close(), /Browser cleanup failed/)
            await assert.rejects(session.closed, /Browser cleanup failed/)
          } else {
            await Promise.all([session.close(), session.closed])
          }
          assert.deepEqual(events, scenario === 'save failure'
            ? ['read', 'close', 'proxy', 'display', 'slot']
            : ['read', 'saved', 'close', 'proxy', 'display', 'slot'])
        }
      }
      console.log('shutdown order verified')
    } finally {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
      fs.rmSync(root, { recursive: true, force: true })
    }
  `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 })
  assert.match(output, /shutdown order verified/)
})
}
