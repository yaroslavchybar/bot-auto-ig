import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('model setup waits until day 3, then connects mobile before changing the name', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'

    const browserLoggedInAt = Date.parse('2026-09-25T12:00:00Z')
    let now = Date.parse('2026-09-26T12:00:00Z')
    Date.now = () => now
    const events = []
    const profile = { id: 'profile', name: 'oldname', proxy: 'http://work:8080',
      igLoggedIn: true, listIds: ['model'], status: 'active', using: false, createdAt: 1 }
    const model = { id: 'model', fullNames: ['Model Name'] }
    const account = { id: 'account', username: 'oldname', status: 'assigned', browserLoggedInAt }
    let state

    mock.module('./server/shared/convexClient.ts', () => ({
      automationsList: async () => [{ _id: 'automation', isActive: true,
        routine: {}, listIds: ['model'] }],
      listsList: async () => [model],
      profilesList: async () => [profile],
      routineReady: async () => { events.push('ready');
        assert.equal(account.status, 'connected'); return true },
      igAccountRequest: async (operation, args) => {
        if (operation === 'modelSetupList') return state ? [state] : []
        if (operation === 'modelSetupEnroll') {
          state = { profileId: args.profileId, modelId: args.modelId,
            startedAt: args.startedAt, postSourceIds: [], postDates: [] }
          return state
        }
        if (operation === 'modelSetupPatch') {
          Object.assign(state, args.patch)
          for (const key of args.clear) delete state[key]
          return null
        }
        throw new Error('Unexpected request: ' + operation)
      },
    }))
    mock.module('./server/ig-accounts/store.ts', () => ({
      accountForProfile: async () => account,
      setAccountUsername: async (_id, username) => { account.username = username },
    }))
    mock.module('./server/ig-accounts/login.ts', () => ({
      connectScheduledMobile: async () => {
        assert.equal(profile.proxy, 'http://work:8080')
        events.push('mobile')
        account.status = 'connected'
      },
    }))
    mock.module('./server/ig-accounts/usernames.ts', () => ({
      usernameCandidates: async () => ['newname'],
      fullNameForGroup: async () => { throw new Error('Unexpected full-name generation') },
    }))
    mock.module('./server/ig-accounts/mobile.ts', () => ({
      runMobileAction: async (_profileId, action) => {
        assert.deepEqual(action, { action: 'name', targetUsername: 'newname',
          fullName: 'Model Name' })
        events.push('name')
        return { ok: true }
      },
    }))
    mock.module('./server/ig-accounts/profileName.ts', () => ({
      syncConnectedProfileName: async () => { events.push('sync') },
    }))
    mock.module('./server/ig-accounts/content.ts', () => ({
      allocateContent: async () => { throw new Error('Content is not due') },
    }))

    const { sweepModelWarmup } = await import('./server/ig-accounts/warmup.ts')
    await sweepModelWarmup()
    assert.equal(state.startedAt, browserLoggedInAt)
    assert.deepEqual(events, [])
    now = Date.parse('2026-09-27T12:00:00Z')
    await sweepModelWarmup()
    assert.deepEqual(events, ['mobile', 'ready', 'name', 'sync'])
    assert.equal(state.nameDone, true)
    assert.equal(account.username, 'newname')
  `], { stdio: 'pipe' })
})
