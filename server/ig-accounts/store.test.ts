import { afterEach, expect, mock, test } from 'bun:test'
const request = mock((_operation: string, _args?: unknown): Promise<unknown> => Promise.resolve(undefined))
mock.module('../shared/convexClient.js', () => ({ igAccountRequest: request }))
const { availableAccounts, decryptAccount, encryptAccount, listAccounts } = await import('./store.js')

afterEach(() => { delete process.env.IG_CREDENTIALS_KEY; request.mockReset() })

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

test('one unreadable row stays visible but does not block other account batches', async () => {
  process.env.IG_CREDENTIALS_KEY = 'a'.repeat(64)
  const invalid = { _id: 'bad', status: 'available', createdAt: 1,
    ...encryptAccount({ username: 'broken', password: 'secret', authenticatorKey: 'JBSWY3DPEHPK3PXP' }),
    ciphertext: 'v1.corrupt' }
  const valid = { _id: 'good', status: 'available', createdAt: 2,
    ...encryptAccount({ username: 'working', password: 'secret', authenticatorKey: 'JBSWY3DPEHPK3PXP' }) }
  request.mockImplementation(async (operation: string, args?: { cursor?: string }) =>
    operation === 'available'
      ? args?.cursor
        ? { page: [valid], continueCursor: '', isDone: true }
        : { page: [invalid], continueCursor: 'next', isDone: false }
      : [invalid, valid])

  expect(await listAccounts()).toEqual([
    { id: 'bad', username: '', status: 'invalid', profileId: undefined,
      error: 'Credential cannot be decrypted', createdAt: 1 },
    { id: 'good', username: 'working', status: 'available', profileId: undefined,
      error: undefined, createdAt: 2, browserLoggedInAt: undefined },
  ])
  expect((await availableAccounts(1)).map(row => row.id)).toEqual(['good'])
  expect(request).toHaveBeenCalledWith('available', { count: 20, cursor: undefined })
  expect(request).toHaveBeenCalledWith('available', { count: 20, cursor: 'next' })
})
