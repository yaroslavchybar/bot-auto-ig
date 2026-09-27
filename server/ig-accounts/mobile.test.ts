import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('mobile username and full-name actions stay separate and handle lookup errors', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'

    let fail = true
    let profile = null
    const calls = []
    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetById: async () => {
        if (fail) throw new Error('Convex unavailable')
        return profile
      },
    }))
    mock.module('./server/chat/instagram.ts', () => ({
      InstagramChat: { load: async () => ({
        updateUsername: async username => { calls.push(['username', username]) },
        updateFullName: async fullName => { calls.push(['fullName', fullName]) },
      }) },
    }))

    const { runMobileAction } = await import('./server/ig-accounts/mobile.ts')
    const action = { action: 'username', targetUsername: 'newname' }
    assert.deepEqual(await runMobileAction('profile-id', action), { ok: false, errorType: 'Error' })
    fail = false
    assert.deepEqual(await runMobileAction('profile-id', action), { ok: false, errorType: 'ProfileMissing' })
    profile = { id: 'profile-id' }
    assert.deepEqual(await runMobileAction('profile-id', action), { ok: true })
    assert.deepEqual(await runMobileAction('profile-id', { action: 'fullName', fullName: 'Name' }), { ok: true })
    assert.deepEqual(calls, [['username', 'newname'], ['fullName', 'Name']])
  `], { stdio: 'pipe' })
})
