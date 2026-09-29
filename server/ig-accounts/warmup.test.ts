import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('model setup advances only after a browser session and keeps the day 3 and day 4 steps', async () => {
  const image = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'warmup-post-')), 'warmup-post.jpg')
  await fs.writeFile(image, Buffer.from('jpeg'))
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
      automationsGetById: async () => ({ _id: 'automation', isActive: true,
        routine: {}, listIds: ['model'] }),
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
          if (failPatch && args.patch.postDates) throw new Error('save failed')
          Object.assign(state, args.patch)
          for (const key of args.clear) delete state[key]
          return null
        }
        if (operation === 'modelSetupReconcile') {
          state.pending = undefined
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
        if (action.action === 'username')
          assert.deepEqual(action, { action: 'username', targetUsername: 'newname' })
        if (action.action === 'fullName')
          assert.deepEqual(action, { action: 'fullName', fullName: model.fullNames[0] })
        events.push(action.action)
        return { ok: true }
      },
    }))
    let publishMode = 'ok'
    let failPatch = false
    mock.module('./server/automation/actions/publish.ts', () => ({
      publishFeedPost: async (_page, image, log) => {
        events.push('session-post:' + image.name)
        if (publishMode === 'unknown') log({ event: 'automation.post_unconfirmed', message: 'Post publish failed: share did not confirm' })
        return publishMode === 'ok'
      },
    }))
    mock.module('./server/ig-accounts/profileName.ts', () => ({
      syncConnectedProfileName: async () => { events.push('sync') },
    }))
    mock.module('./server/ig-accounts/content.ts', () => ({
      allocateContent: async (_modelId, kind) => ({ sourceId: kind,
        path: kind === 'posts' ? process.env.WARMUP_POST_IMAGE : kind }),
    }))

    const { sweepModelWarmup, advanceModelWarmup, reconcileModelWarmup, postModelUpdateInSession } =
      await import('./server/ig-accounts/warmup.ts')
    await sweepModelWarmup()
    assert.equal(state.startedAt, browserLoggedInAt)
    assert.deepEqual(events, [])
    await advanceModelWarmup('profile', 'automation')
    assert.deepEqual(events, [])
    now = Date.parse('2026-09-27T12:00:00Z')
    await sweepModelWarmup()
    assert.deepEqual(events, [])
    await advanceModelWarmup('profile', 'automation')
    assert.deepEqual(events, ['mobile', 'ready', 'username', 'sync'])
    assert.equal(state.nameDone, true)
    assert.equal(state.fullNameDone, undefined)
    assert.equal(account.username, 'newname')
    await advanceModelWarmup('profile', 'automation')
    assert.deepEqual(events.slice(-2), ['ready', 'fullName'])
    assert.equal(state.fullNameDone, true)
    now = Date.parse('2026-09-28T12:00:00Z')
    await advanceModelWarmup('profile', 'automation')
    assert.deepEqual(events.slice(-2), ['ready', 'avatar'])
    assert.equal(state.avatarDone, true)
    assert.deepEqual(state.postSourceIds, [])

    // The photo goes out on the live routine page, never in a post-only session.
    assert.equal(await postModelUpdateInSession('profile', 'model', {}, () => {}), true)
    assert.deepEqual(state.postSourceIds, ['posts'])
    assert.deepEqual(state.postDates, ['2026-09-28'])
    assert.ok(events.some(event => event.startsWith('session-post:')))
    assert.equal(await postModelUpdateInSession('profile', 'model', {}, () => {}), false)
    assert.deepEqual(state.postSourceIds, ['posts'])

    // A failure before Share releases the profile; an unconfirmed Share stays pending.
    now = Date.parse('2026-09-29T12:00:00Z')
    publishMode = 'skipped'
    assert.equal(await postModelUpdateInSession('profile', 'model', {}, () => {}), false)
    assert.equal(state.pending, undefined)
    assert.ok(String(state.error).includes('BrowserPostFailed'))
    assert.deepEqual(state.postSourceIds, ['posts'])
    publishMode = 'unknown'
    assert.equal(await postModelUpdateInSession('profile', 'model', {}, () => {}), false)
    assert.equal(state.pending.kind, 'post')
    assert.ok(String(state.error).includes('share did not confirm'))
    state.pending = undefined
    state.error = undefined
    publishMode = 'ok'

    // A save failure after a confirmed Share keeps pending with a do-not-retry error.
    failPatch = true
    assert.equal(await postModelUpdateInSession('profile', 'model', {}, () => {}), false)
    assert.equal(state.pending.kind, 'post')
    assert.ok(String(state.error).includes('duplicate'))
    assert.deepEqual(state.postSourceIds, ['posts'])
    failPatch = false
    state.pending = undefined
    state.error = undefined

    // Existing profiles can keep posting without a configured full name, then change it later.
    state.fullNameDone = undefined
    state.fullName = undefined
    model.fullNames = []
    now = Date.parse('2026-09-29T12:00:00Z')
    await advanceModelWarmup('profile', 'automation')
    assert.equal(events.at(-1), 'ready')
    model.fullNames = ['Late Name']
    now = Date.parse('2026-09-30T12:00:00Z')
    await advanceModelWarmup('profile', 'automation')
    assert.equal(events.at(-1), 'fullName')
    assert.equal(state.fullNameDone, true)
    assert.equal(account.username, 'newname')
    state.pending = { kind: 'name', date: '2026-09-30' }
    state.targetUsername = 'legacyname'
    await reconcileModelWarmup('profile', 'completed')
    assert.equal(account.username, 'legacyname')
    assert.equal(state.pending, undefined)
    assert.equal(events.at(-1), 'sync')
  `], { stdio: 'pipe', env: { ...process.env, WARMUP_POST_IMAGE: image } })
})
