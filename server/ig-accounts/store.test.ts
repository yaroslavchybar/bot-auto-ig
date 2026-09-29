import { afterEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { decryptAccount, encryptAccount } from './store.js'

afterEach(() => { delete process.env.IG_CREDENTIALS_KEY })

test('Convex receives only encrypted credentials and a keyed username lookup', () => {
  process.env.IG_CREDENTIALS_KEY = 'a'.repeat(64)
  const account = { username: 'example_user', password: 'private-password',
    authenticatorKey: 'JBSWY3DPEHPK3PXP' }
  const encrypted = encryptAccount(account)
  expect(JSON.stringify(encrypted)).not.toContain(account.username)
  expect(JSON.stringify(encrypted)).not.toContain(account.password)
  expect(JSON.stringify(encrypted)).not.toContain(account.authenticatorKey)
  expect(decryptAccount(encrypted)).toEqual(account)
  expect(encryptAccount(account).usernameHash).toBe(encrypted.usernameHash)
  expect(encryptAccount(account).ciphertext).not.toBe(encrypted.ciphertext)
  expect(() => decryptAccount({ ...encrypted, usernameHash: 'b'.repeat(64) })).toThrow()
})

test('one unreadable row stays visible but does not block other account batches', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    process.env.IG_CREDENTIALS_KEY = 'a'.repeat(64)
    const request = mock(async (operation, args) => {
      if (operation === 'connectedNames') return args?.cursor
        ? { page: [{ account: valid, profileName: 'Working profile' }], continueCursor: '', isDone: true }
        : { page: [{ account: invalid }], continueCursor: 'next', isDone: false }
      return operation === 'available'
        ? args?.cursor
          ? { page: [valid], continueCursor: '', isDone: true }
          : { page: [invalid], continueCursor: 'next', isDone: false }
        : [invalid, valid]
    })
    mock.module('./server/shared/convexClient.ts', () => ({ igAccountRequest: request }))
    const { availableAccounts, connectedNames, encryptAccount, listAccounts } = await import('./server/ig-accounts/store.ts')
    const invalid = { _id: 'bad', status: 'available', createdAt: 1,
      ...encryptAccount({ username: 'broken', password: 'secret', authenticatorKey: 'JBSWY3DPEHPK3PXP' }),
      ciphertext: 'v1.corrupt' }
    const valid = { _id: 'good', status: 'available', createdAt: 2,
      ...encryptAccount({ username: 'working', password: 'secret', authenticatorKey: 'JBSWY3DPEHPK3PXP' }) }

    assert.deepEqual(await listAccounts(), [
      { id: 'bad', username: '', status: 'invalid', profileId: undefined,
        error: 'Credential cannot be decrypted', createdAt: 1 },
      { id: 'good', username: 'working', status: 'available', profileId: undefined,
        error: undefined, createdAt: 2, browserLoggedInAt: undefined },
    ])
    assert.deepEqual((await availableAccounts(1)).map(row => row.id), ['good'])
    assert.deepEqual(request.mock.calls.map(call => call[1]).filter(args => args?.count), [
      { count: 20, cursor: undefined }, { count: 20, cursor: 'next' },
    ])
    const connected = await connectedNames()
    assert.deepEqual(connected.map(row => [row.account.id, row.profileName]), [['good', 'Working profile']])
    assert.deepEqual(request.mock.calls.filter(call => call[0] === 'connectedNames').map(call => call[1]), [
      { cursor: undefined }, { cursor: 'next' },
    ])
  `], { cwd: new URL('../../', import.meta.url), timeout: 15_000 })
})
