import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const workerCode = `
  import { mock } from 'bun:test'
  import { createInterface } from 'node:readline'
  mock.module('./server/shared/utils.ts', () => ({ resolveProjectRoot: () => process.env.PROFILE_LOCK_TEST_ROOT }))
  const { lockProfile } = await import('./server/profiles/paths.ts')
  let release
  console.log('ready')
  for await (const command of createInterface({ input: process.stdin })) {
    if (command === 'release') {
      release?.()
      release = undefined
      console.log('released')
    } else {
      try { release = lockProfile('Shared'); console.log('acquired') }
      catch (error) {
        if (!/already open/.test(error.message)) throw error
        console.log('busy')
      }
    }
  }
  release?.()
`

test('only one process acquires a profile, including after the owner is killed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-lock-race-'))
  const workers = Array.from({ length: 6 }, () => {
    const child = spawn('bun', ['--eval', workerCode], {
      cwd: new URL('../../', import.meta.url),
      env: { ...process.env, PROFILE_LOCK_TEST_ROOT: root },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    let errors = ''
    child.stderr.on('data', chunk => { errors += chunk })
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    const exited = new Promise<void>(resolve => child.once('close', () => resolve()))
    return { child, lines, exited, errors: () => errors }
  })
  t.after(async () => {
    for (const worker of workers) worker.child.kill('SIGKILL')
    await Promise.all(workers.map(worker => worker.exited))
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    fs.rmSync(root, { recursive: true, force: true })
  })
  for (const worker of workers) assert.equal((await worker.lines.next()).value, 'ready', worker.errors())
  const active = [...workers]
  for (const end of ['release', 'kill', 'release']) {
    // Winners hold the lock until told, so every competing attempt must fail.
    for (const worker of active) worker.child.stdin.write('acquire\n')
    const results = await Promise.all(active.map(async worker => (await worker.lines.next()).value))
    assert.equal(results.filter(result => result === 'acquired').length, 1, JSON.stringify(results))
    assert.equal(results.filter(result => result === 'busy').length, active.length - 1)
    const winnerIndex = results.indexOf('acquired')
    const winner = active[winnerIndex]
    if (end === 'kill') {
      winner.child.kill('SIGKILL')
      await winner.exited
      active.splice(winnerIndex, 1)
    } else {
      winner.child.stdin.write('release\n')
      assert.equal((await winner.lines.next()).value, 'released')
    }
  }
})

test('profile locks reject device names and keep independent profiles independent', () => {
  execFileSync('bun', ['--eval', `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-lock-names-'))
    mock.module('./server/shared/utils.ts', () => ({ resolveProjectRoot: () => root }))
    const { lockProfile, validateProfileName } = await import('./server/profiles/paths.ts')
    try {
      for (const name of ['CON', 'con.txt', 'PRN', 'AUX.json', 'NUL', 'COM1', 'com9.txt', 'LPT1', 'lpt9.log']) {
        assert.throws(() => validateProfileName(name), /Invalid profile name/)
        assert.throws(() => lockProfile(name), /Invalid profile name/)
      }
      for (const name of ['console', 'COM10', 'LPT0', 'normal.profile']) validateProfileName(name)
      const releaseA = lockProfile('A')
      const releaseB = lockProfile('B')
      assert.throws(() => lockProfile('a'), /already open/)
      releaseB()
      assert.throws(() => lockProfile('A'), /already open/)
      releaseA()
      releaseA()
      const next = lockProfile('A')
      releaseA() // An old release cannot unlock the next owner.
      assert.throws(() => lockProfile('A'), /already open/)
      next()
      assert.ok(fs.existsSync(path.join(root, 'data/profile-locks/a.sqlite')))
    } finally {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
      fs.rmSync(root, { recursive: true, force: true })
    }
  `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 })
})
