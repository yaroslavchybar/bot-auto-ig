import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('mobile action handles profile lookup errors and missing profiles', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'

    let fail = true
    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetById: async () => {
        if (fail) throw new Error('Convex unavailable')
        return null
      },
    }))
    mock.module('./server/chat/instagram.ts', () => ({
      InstagramChat: { load: async () => { throw new Error('Chat should not load') } },
    }))

    const { runMobileAction } = await import('./server/ig-accounts/mobile.ts')
    const action = { action: 'name', targetUsername: 'newname', fullName: 'Name' }
    assert.deepEqual(await runMobileAction('profile-id', action), { ok: false, errorType: 'Error' })
    fail = false
    assert.deepEqual(await runMobileAction('profile-id', action), { ok: false, errorType: 'ProfileMissing' })
  `], { stdio: 'pipe' })
})
