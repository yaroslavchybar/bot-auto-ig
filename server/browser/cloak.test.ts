import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('missing and pending profiles cannot recreate folders and always release their lock', () => {
  execFileSync('bun', ['--eval', `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-launch-'))
    let row
    mock.module('./server/shared/utils.ts', () => ({ resolveProjectRoot: () => root }))
    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetByName: async () => row,
      profilesUpdateByName: async () => undefined,
    }))
    mock.module('cloakbrowser', () => ({
      binaryInfo: () => ({}),
      launchPersistentContext: async () => { throw new Error('Must not launch') },
    }))
    const { openBrowserSession } = await import('./server/browser/cloak.ts')
    const { lockProfile } = await import('./server/profiles/paths.ts')
    try {
      for (const value of [null, { name: 'test', status: 'deleting' }, { name: 'test', renameFrom: 'old' }]) {
        row = value
        await assert.rejects(openBrowserSession('test'), /not found|maintenance/)
        assert.equal(fs.existsSync(path.join(root, 'data/profiles/test')), false)
        lockProfile('test')()
      }
    } finally {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
      fs.rmSync(root, { recursive: true, force: true })
    }
  `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 })
})

for (const scenario of ['stop', 'crash', 'startup failure', 'stop during launch', 'stop during navigation', 'budget lost during launch', 'cleanup failure', 'save failure', 'clear cookies', 'replace cookies']) {
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
    mock.module('./server/browser/filePicker.ts', () => ({ pickerSocket: () => 'test', startFilePicker: async () => () => {} }))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-shutdown-'))
    const cache = path.join(root, 'data/profiles/test/Default/Cache')
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(path.join(cache, 'old-cache'), 'cached video')
    const events = []
    const cookies = [{ name: 'sessionid', value: 'test-session', domain: '.instagram.com', path: '/' }]
    const context = new EventEmitter()
    let jar = [{ name: 'old-session', value: 'stale', domain: '.instagram.com', path: '/' }]
    context.clearCookies = async () => { jar = [] }
    context.addCookies = async values => { jar.push(...values) }
    let loseBudget
    let closed = false
    let launchOptions
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
      return scenario === 'clear cookies' || scenario === 'replace cookies' ? jar : cookies
    }
    context.close = async () => {
      closed = true
      events.push('close')
      context.emit('close')
    }
    mock.module('cloakbrowser', () => ({ binaryInfo: () => ({ tier: 'test', version: 'test' }), launchPersistentContext: async options => {      launchOptions = options
      assert.equal(fs.existsSync(cache), false, 'cache is pruned before launch')
      assert.ok(options.args.includes('--disk-cache-size=134217728'))
      assert.throws(() => lockProfile('test'), /already open/)
      if (scenario === 'stop during launch') process.emit('SIGTERM')
      if (scenario === 'budget lost during launch') loseBudget()
      // Model Playwright's default competing shutdown handler.
      for (const signal of ['SIGINT', 'SIGTERM']) {
        if (options.launchOptions?.['handle' + signal] !== false)
          process.once(signal, () => { void context.close() })
      }
      return context
    } }))
    mock.module('./server/shared/utils.ts', () => ({ resolveProjectRoot: () => root }))
    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetByName: async () => ({ name: 'test', cookiesJson: scenario === 'replace cookies' ? JSON.stringify(cookies) : undefined }),
      profilesUpdateByName: async (name, update) => {
        if (scenario === 'save failure') throw new Error('Database unavailable')
        await new Promise(resolve => setTimeout(resolve, 10))
        assert.equal(closed, false, 'browser must stay open until persistence completes')
        assert.equal(name, 'test')
        assert.deepEqual(JSON.parse(update.cookiesJson), scenario === 'clear cookies' ? [] : cookies)
        events.push('saved')
      },
    }))
    mock.module('./server/browser/budget.ts', () => ({ acquireBrowserSlot: async (_signal, _address, onLost) => {
      loseBudget = onLost
      return () => {
        lockProfile('test')()
        events.push('slot')
      }
    } }))
    mock.module('./server/browser/display.ts', () => ({ allocateDisplay: async () => ({
      display: ':100', close: async () => {
        events.push('display')
        if (scenario === 'cleanup failure') throw new Error('Display cleanup failed')
      },
    }) }))
    const { lockProfile } = await import('./server/profiles/paths.ts')
    try {
      const { openBrowserSession } = await import('./server/browser/cloak.ts')
      if (['startup failure', 'stop during launch', 'stop during navigation', 'budget lost during launch'].includes(scenario)) {
        const expected = ['startup failure', 'stop during navigation'].includes(scenario) ? /Navigation failed/
          : scenario === 'stop during launch' ? /Browser worker stopped/ : /budget disconnected/
        await assert.rejects(openBrowserSession('test'), expected)
        assert.deepEqual(events, ['close', 'display', 'slot'])
      } else {
        const session = await openBrowserSession('test')
        if (scenario === 'clear cookies') assert.deepEqual(jar, [], 'cleared cookies must not survive on disk')
        if (scenario === 'replace cookies') assert.deepEqual(jar, cookies, 'imports must replace rather than merge old cookies')
        // Cloak stealth wiring: persistent profile, human behavior, seed identity.
        assert.ok(String(launchOptions.userDataDir).endsWith('test'))
        assert.equal(launchOptions.humanize, true)
        assert.ok(launchOptions.args.some(arg => String(arg).startsWith('--fingerprint=')))
        if (scenario === 'crash') {
          closed = true
          context.emit('close')
          await session.closed
          assert.deepEqual(events, ['display', 'slot'])
        } else {
          process.emit('SIGTERM')
          assert.equal(session.close(), session.close())
          if (scenario === 'cleanup failure' || scenario === 'save failure') {
            await assert.rejects(session.close(), /Browser cleanup failed/)
            await assert.rejects(session.closed, /Browser cleanup failed/)
          } else {
            await Promise.all([session.close(), session.closed])
          }
          assert.deepEqual(events, scenario === 'save failure'
            ? ['read', 'close', 'display', 'slot']
            : ['read', 'saved', 'close', 'display', 'slot'])
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

test('cloak seed is stable per profile and platform', () => {
  const output = execFileSync('bun', ['--eval', `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloak-seed-'))
    try {
      mock.module('cloakbrowser', () => ({ binaryInfo: () => ({ tier: 'test', version: 'test' }), launchPersistentContext: async () => { throw new Error('no launch') } }))
      mock.module('./server/shared/utils.ts', () => ({ resolveProjectRoot: () => root }))
      mock.module('./server/shared/convexClient.ts', () => ({
        profilesGetByName: async () => undefined,
        profilesUpdateByName: async () => undefined,
      }))
      const { cloakSeed, cloakPlatform, migrateFirefoxProfile } = await import('./server/browser/cloak.ts')
      assert.equal(cloakPlatform('mac'), 'macos')
      assert.equal(cloakPlatform('windows'), 'windows')
      assert.equal(cloakPlatform('linux'), 'windows')
      const dir = path.join(root, 'data', 'profiles', 'test')
      fs.mkdirSync(dir, { recursive: true })
      const first = cloakSeed(dir, 'windows')
      assert.equal(cloakSeed(dir, 'windows'), first)
      assert.notEqual(cloakSeed(dir, 'macos'), first)
      const mig = path.join(root, 'data', 'profiles', 'mig')
      fs.mkdirSync(path.join(mig, 'cache2'), { recursive: true })
      fs.writeFileSync(path.join(mig, 'fingerprint.json'), '{}')
      fs.writeFileSync(path.join(mig, 'prefs.js'), '')
      fs.writeFileSync(path.join(mig, 'cache2', 'data'), 'x')
      migrateFirefoxProfile(mig)
      assert.deepEqual(fs.readdirSync(mig), [])
      fs.writeFileSync(path.join(mig, 'cloak-seed.json'), '{}')
      fs.writeFileSync(path.join(mig, 'keep.txt'), '')
      migrateFirefoxProfile(mig)
      assert.deepEqual(fs.readdirSync(mig).sort(), ['cloak-seed.json', 'keep.txt'])
      console.log('seed stable verified')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 })
  assert.match(output, /seed stable verified/)
})
