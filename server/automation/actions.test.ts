import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { followUsers, sendMessages } from './actions.js'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function database() {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/message-templates')) return Response.json(['Hello'])
    if (url.includes('/for-profile') || url.includes('/to-message'))
      return Response.json([{ id: 'account', user_name: 'target' }])
    throw new Error(`Unexpected database write: ${url}`)
  }) as typeof fetch
  return calls
}

test('failed navigation does not interact with the previous profile or update account status', async () => {
  const calls = database()
  const page = {
    goto: async () => {
      throw new Error('Navigation failed')
    },
    locator: () => {
      throw new Error('Must not click')
    },
  } as unknown as Page
  await assert.rejects(
    followUsers(
      page,
      'profile',
      () => {},
      () => false,
    ),
    /Navigation failed/,
  )
  assert.equal(calls.length, 1)
})

test('a failed click is not recorded as a successful follow', async () => {
  const calls = database()
  const item = {
    isVisible: async () => true,
    click: async () => {
      throw new Error('Click failed')
    },
  }
  const page = {
    goto: async () => {},
    locator: () => ({ count: async () => 1, nth: () => item }),
  } as unknown as Page
  await assert.rejects(
    followUsers(
      page,
      'profile',
      () => {},
      () => false,
    ),
    /Click failed/,
  )
  assert.equal(calls.length, 1)
})

test('failed message submission does not mark the recipient messaged', async () => {
  const calls = database()
  const composer = {
    fill: async () => {},
    press: async () => {
      throw new Error('Send failed')
    },
  }
  const page = {
    goto: async () => {},
    locator: () => ({
      count: async () => 1,
      nth: () => ({ isVisible: async () => true, click: async () => {} }),
      last: () => composer,
    }),
  } as unknown as Page
  await assert.rejects(
    sendMessages(
      page,
      'profile',
      () => {},
      () => false,
      {
        template_kind: 'message_2',
        messaging_cooldown_enabled: true,
        messaging_cooldown_hours: 2,
      },
    ),
    /Send failed/,
  )
  assert.ok(calls.some((url) => url.includes('kind=message_2')))
  assert.ok(calls.some((url) => url.includes('cooldownHours=2')))
  assert.equal(calls.length, 2)
})
