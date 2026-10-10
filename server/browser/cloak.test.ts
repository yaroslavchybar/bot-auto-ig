import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('missing and pending profiles cannot recreate folders and always release their lock', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-launch-'))
    let row
    const heldLocks = new Set()
    const lockProfile = (name) => {
      if (heldLocks.has(name)) throw new Error('Profile is already open')
      heldLocks.add(name)
      return () => heldLocks.delete(name)
    }
    mock.module('./server/profiles/paths.ts', () => ({
      profileDirectory: name => path.join(root, 'data/profiles', name),
      acquireProfileLock: async name => lockProfile(name),
    }))
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
  `,
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 },
  )
})

for (const scenario of [
  'stop',
  'manual inspection',
  'stop during inspector startup',
  'crash',
  'startup failure',
  'stop during launch',
  'stop during navigation',
  'cancel during budget',
  'cancel during launch',
  'cancel during navigation',
  'budget lost during launch',
  'profile lock lost during budget',
  'profile lock lost during display',
  'profile lock lost during launch',
  'profile lock lost during file picker',
  'launch timeout resolves',
  'launch timeout rejects',
  'launch timeout close fails',
  'cleanup failure',
  'save failure',
  'clear cookies',
  'replace cookies',
  'seed persistence retry',
  'seed persistence failure',
]) {
  test(`browser cleanup: ${scenario}`, () => {
    // Isolate module mocks and process signal handlers from other tests.
    const output = execFileSync(
      'bun',
      [
        '--eval',
        `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'
    import { EventEmitter } from 'node:events'

    const scenario = ${JSON.stringify(scenario)}
    const timeoutCase = scenario.startsWith('launch timeout')
    const originalSetTimeout = globalThis.setTimeout
    if (timeoutCase) globalThis.setTimeout = (fn, ms, ...args) => originalSetTimeout(fn, ms === 90_000 ? 10 : ms, ...args)
    let finishLaunch, failLaunch, finishLateClose
    const pendingLaunch = new Promise((resolve, reject) => { finishLaunch = resolve; failLaunch = reject })
    const lateClosing = new Promise(resolve => { finishLateClose = resolve })
    const cancellation = new AbortController()
    let loseProfileLock
    const inspect = ['manual inspection', 'stop during inspector startup'].includes(scenario)
    mock.module('./server/browser/filePicker.ts', () => ({ pickerSocket: () => 'test', startFilePicker: async () => {
      if (scenario === 'profile lock lost during file picker') {
        loseProfileLock()
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return () => { if (scenario === 'profile lock lost during file picker') events.push('picker') }
    } }))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-shutdown-'))
    const seedWrites = []
    let seedWriteDone = false
    if (scenario === 'seed persistence retry') {
      const profileDir = path.join(root, 'data/profiles/test')
      fs.mkdirSync(profileDir, { recursive: true })
      fs.writeFileSync(path.join(profileDir, 'cloak-seed.json'), JSON.stringify({ platform: 'windows', seed: 43210 }))
    }
    const cache = path.join(root, 'data/profiles/test/Default/Cache')
    const inspectorPath = path.join(root, 'data/profiles/test/dom-inspector.json')
    const devToolsPortFile = path.join(root, 'data/profiles/test/DevToolsActivePort')
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(path.join(cache, 'old-cache'), 'cached video')
    fs.writeFileSync(devToolsPortFile, 'stale port')
    const events = []
    let inspectorClosed = false
    const cookies = [{ name: 'sessionid', value: 'test-session', domain: '.instagram.com', path: '/' }]
    const context = new EventEmitter()
    let jar = [{ name: 'old-session', value: 'stale', domain: '.instagram.com', path: '/' }]
    context.clearCookies = async () => { jar = [] }
    context.addCookies = async values => { jar.push(...values) }
    let loseBudget
    let closed = false
    let launchOptions
    context.pages = () => [{
      url: () => ['startup failure', 'stop during navigation', 'cancel during navigation'].includes(scenario) ? 'about:blank' : 'https://www.instagram.com/',
      goto: async () => {
        if (['stop during navigation', 'cancel during navigation'].includes(scenario)) {
          await new Promise(resolve => {
            context.once('close', resolve)
            if (scenario === 'cancel during navigation') cancellation.abort(new Error('Login cancelled'))
            else process.emit('SIGTERM')
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
      if (timeoutCase) {
        events.push('close')
        await lateClosing
        if (scenario === 'launch timeout close fails') throw new Error('Browser close failed')
      }
      closed = true
      if (!timeoutCase) events.push('close')
      context.emit('close')
    }
    if (scenario === 'stop during inspector startup') {
      mock.module('./server/browser/domInspector.ts', () => ({ startDomInspector: async () => {
        fs.writeFileSync(inspectorPath, 'listening')
        process.emit('SIGTERM')
        await new Promise(resolve => context.once('close', resolve))
        return { close: async () => {
          inspectorClosed = true
          fs.rmSync(inspectorPath, { force: true })
        } }
      } }))
    }
    mock.module('cloakbrowser', () => ({ binaryInfo: () => ({ tier: 'test', version: 'test' }), launchPersistentContext: async options => {      launchOptions = options
      if (scenario === 'seed persistence retry') assert.equal(seedWriteDone, true, 'launch waits for seed persistence')
      assert.equal(fs.existsSync(cache), false, 'cache is pruned before launch')
      assert.ok(options.args.includes('--disk-cache-size=134217728'))
      assert.equal(options.args.includes('--remote-debugging-port=0'), inspect)
      assert.equal(options.args.includes('--remote-debugging-address=127.0.0.1'), inspect)
      assert.equal(fs.existsSync(devToolsPortFile), false, 'stale DevTools port is cleared before launch')
      if (inspect) fs.writeFileSync(devToolsPortFile, '45678')
      assert.throws(() => lockProfile('test'), /already open/)
      if (scenario === 'stop during launch') process.emit('SIGTERM')
      if (scenario === 'cancel during launch') cancellation.abort(new Error('Login cancelled'))
      if (scenario === 'budget lost during launch') loseBudget()
      if (scenario === 'profile lock lost during launch') {
        loseProfileLock()
        await new Promise(resolve => setTimeout(resolve, 10))
        assert.throws(() => lockProfile('test'), /already open/, 'keep the profile locked until launch settles')
      }
      if (timeoutCase) await pendingLaunch
      // Model Playwright's default competing shutdown handler.
      for (const signal of ['SIGINT', 'SIGTERM']) {
        if (options.launchOptions?.['handle' + signal] !== false)
          process.once(signal, () => { void context.close() })
      }
      return context
    } }))
    const heldLocks = new Set()
    const lockProfile = (name) => {
      if (heldLocks.has(name)) throw new Error('Profile is already open')
      heldLocks.add(name)
      return () => heldLocks.delete(name)
    }
    mock.module('./server/profiles/paths.ts', () => ({
      profileDirectory: name => path.join(root, 'data/profiles', name),
      acquireProfileLock: async (name, _signal, onLost) => {
        loseProfileLock = onLost
        return lockProfile(name)
      },
    }))
    mock.module('./server/shared/utils.ts', () => ({ resolveProjectRoot: () => root }))
    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetByName: async () => ({ name: 'test', cookiesJson: scenario === 'replace cookies' ? JSON.stringify(cookies) : undefined }),
      profilesUpdateByName: async (name, update) => {
        if (typeof update.fingerprintSeed === 'number') {
          seedWrites.push(update.fingerprintSeed)
          if (scenario === 'seed persistence failure') throw new Error('Database unavailable')
          if (scenario === 'seed persistence retry') await new Promise(resolve => setTimeout(resolve, 20))
          seedWriteDone = true
          return undefined
        }
        if (scenario === 'save failure') throw new Error('Database unavailable')
        await new Promise(resolve => setTimeout(resolve, 10))
        assert.equal(closed, false, 'browser must stay open until persistence completes')
        assert.equal(name, 'test')
        assert.deepEqual(JSON.parse(update.cookiesJson), scenario === 'clear cookies' ? [] : cookies)
        events.push('saved')
      },
    }))
    mock.module('./server/browser/budget.ts', () => ({ acquireBrowserSlot: async (_signal, onLost) => {
      if (scenario === 'cancel during budget') {
        cancellation.abort(new Error('Login cancelled'))
        _signal.throwIfAborted()
      }
      loseBudget = onLost
      if (scenario === 'profile lock lost during budget') {
        loseProfileLock()
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return () => {
        lockProfile('test')()
        events.push('slot')
      }
    } }))
    mock.module('./server/browser/display.ts', () => ({ allocateDisplay: async () => {
      if (scenario === 'profile lock lost during display') {
        loseProfileLock()
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return {
      display: ':100', close: async () => {
        events.push('display')
        if (scenario === 'cleanup failure') throw new Error('Display cleanup failed')
      },
    } } }))

    try {
      const { openBrowserSession } = await import('./server/browser/cloak.ts')
      if (timeoutCase) {
        const error = await openBrowserSession('test').then(() => assert.fail('startup must time out'), error => error)
        assert.match(error.message, /Browser launch timed out/)
        assert.deepEqual(events, [], 'timeout must retain resources while launch is pending')
        assert.throws(() => lockProfile('test'), /already open/)
        let settled = false
        const cleanup = error.cleanup.then(() => { settled = true }, error => { settled = true; throw error })
        if (scenario === 'launch timeout rejects') failLaunch(new Error('Late launch failure'))
        else {
          finishLaunch()
          await new Promise(resolve => originalSetTimeout(resolve, 10))
          assert.deepEqual(events, ['close'], 'display and slot remain held until the late browser closes')
          assert.equal(settled, false)
          assert.throws(() => lockProfile('test'), /already open/)
          finishLateClose()
        }
        if (scenario === 'launch timeout close fails') await assert.rejects(cleanup, /Browser cleanup failed/)
        else await cleanup
        assert.deepEqual(events, scenario === 'launch timeout rejects' ? ['display', 'slot'] : ['close', 'display', 'slot'])
        lockProfile('test')()
      } else if (scenario === 'stop during inspector startup') {
        await assert.rejects(openBrowserSession('test', { inspect }), /Browser worker stopped/)
        assert.equal(inspectorClosed, true, 'late inspector is closed after shutdown')
        assert.equal(fs.existsSync(inspectorPath), false)
        assert.equal(fs.existsSync(devToolsPortFile), false)
      } else if (scenario.startsWith('profile lock lost')) {
        await assert.rejects(openBrowserSession('test'), /Profile lock disconnected/)
        const expected = scenario.endsWith('budget') ? ['slot']
          : scenario.endsWith('display') ? ['display', 'slot']
          : scenario.endsWith('file picker') ? ['picker', 'close', 'display', 'slot']
          : ['close', 'display', 'slot']
        assert.deepEqual(events, expected)
        lockProfile('test')()
      } else if (['startup failure', 'stop during launch', 'stop during navigation', 'budget lost during launch', 'seed persistence failure', 'cancel during budget', 'cancel during launch', 'cancel during navigation'].includes(scenario)) {
        const expected = scenario === 'seed persistence failure' ? /Database unavailable/
          : ['startup failure', 'stop during navigation', 'cancel during navigation'].includes(scenario) ? /Navigation failed/
          : scenario.startsWith('cancel') ? /Login cancelled/
          : scenario === 'stop during launch' ? /Browser worker stopped/ : /budget disconnected/
        await assert.rejects(openBrowserSession('test', { signal: cancellation.signal }), expected)
        assert.deepEqual(events, scenario === 'cancel during budget' ? [] : scenario === 'seed persistence failure' ? ['display', 'slot'] : ['close', 'display', 'slot'])
      } else {
        const session = await openBrowserSession('test', { inspect })
        assert.equal(fs.existsSync(inspectorPath), inspect, 'only manual sessions expose a DOM port')
        assert.equal(fs.existsSync(devToolsPortFile), inspect, 'only manual sessions expose a DevTools port')
        if (scenario === 'seed persistence retry') {
          assert.deepEqual(seedWrites, [43210], 'a local seed missing from Convex must be persisted again')
          assert.ok(launchOptions.args.includes('--fingerprint=43210'))
        }
        if (scenario === 'clear cookies') assert.deepEqual(jar, [], 'cleared cookies must not survive on disk')
        if (scenario === 'replace cookies') assert.deepEqual(jar, cookies, 'imports must replace rather than merge old cookies')
        // Cloak stealth wiring: persistent profile, human behavior, seed identity.
        assert.ok(String(launchOptions.userDataDir).endsWith('test'))
        assert.equal(launchOptions.humanize, true)
        assert.ok(launchOptions.args.some(arg => String(arg).startsWith('--fingerprint=')))
        assert.ok(launchOptions.args.includes('--fingerprint-portable-cookies'))
        if (scenario === 'crash') {
          closed = true
          context.emit('close')
          await session.closed
          assert.deepEqual(events, ['read', 'saved', 'display', 'slot'])
        } else {
          process.emit('SIGTERM')
          assert.equal(session.close(), session.close())
          if (scenario === 'cleanup failure' || scenario === 'save failure') {
            await assert.rejects(session.close(), /Browser cleanup failed/)
            await assert.rejects(session.closed, /Browser cleanup failed/)
          } else {
            await Promise.all([session.close(), session.closed])
          }
          assert.deepEqual(events, scenario === 'save failure' || scenario === 'replace cookies'
            ? ['read', 'read', 'close', 'display', 'slot']
            : ['read', 'saved', 'read', 'close', 'display', 'slot'])
        }
        assert.equal(fs.existsSync(inspectorPath), false, 'closing removes the DOM port file')
        assert.equal(fs.existsSync(devToolsPortFile), false, 'closing removes the DevTools port file')
      }
      console.log('shutdown order verified')
    } finally {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
      fs.rmSync(root, { recursive: true, force: true })
    }
  `,
      ],
      { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 },
    )
    assert.match(output, /shutdown order verified/)
  })
}

test('cloak seed is stable per profile and platform', () => {
  const output = execFileSync(
    'bun',
    [
      '--eval',
      `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloak-seed-'))
    try {
      mock.module('cloakbrowser', () => ({ binaryInfo: () => ({ tier: 'test', version: 'test' }), launchPersistentContext: async () => { throw new Error('no launch') } }))
      const heldLocks = new Set()
    const lockProfile = (name) => {
      if (heldLocks.has(name)) throw new Error('Profile is already open')
      heldLocks.add(name)
      return () => heldLocks.delete(name)
    }
    mock.module('./server/profiles/paths.ts', () => ({
      profileDirectory: name => path.join(root, 'data/profiles', name),
      acquireProfileLock: async name => lockProfile(name),
    }))
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
      assert.equal(first.isNew, true)
      assert.equal(cloakSeed(dir, 'windows').seed, first.seed)
      assert.equal(cloakSeed(dir, 'windows').isNew, false)
      assert.notEqual(cloakSeed(dir, 'macos').seed, first.seed)
      const changed = cloakSeed(dir, 'windows', 54321)
      assert.equal(changed.seed, 54321, 'an explicitly saved Convex seed replaces the disk seed')
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'cloak-seed.json'), 'utf8')), {
        platform: 'windows', seed: 54321,
      })
      const moved = path.join(root, 'data', 'profiles', 'moved')
      fs.mkdirSync(moved, { recursive: true })
      const restored = cloakSeed(moved, 'windows', first.seed)
      assert.equal(restored.seed, first.seed)
      assert.equal(restored.isNew, false)
      assert.equal(cloakSeed(moved, 'windows').seed, first.seed)
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
  `,
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 },
  )
  assert.match(output, /seed stable verified/)
})
