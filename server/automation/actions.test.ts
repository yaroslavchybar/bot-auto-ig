import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { followUsers, renderTemplate, sendMessages } from './actions.js'

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
    if (url.includes('/update-message')) return Response.json({ ok: true })
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
    waitFor: async () => {},
    click: async () => {},
    isVisible: async () => false,
    pressSequentially: async () => {
      throw new Error('Send failed')
    },
    press: async () => {},
    inputValue: async () => {
      throw new Error('not an input')
    },
    textContent: async () => '',
  }
  const page = {
    goto: async () => {},
    locator: () => ({
      count: async () => 1,
      nth: () => ({ isVisible: async () => true, click: async () => {} }),
      last: () => composer,
    }),
  } as unknown as Page
  // One bad target must not abort the batch; it is skipped instead.
  await sendMessages(page, 'profile', () => {}, () => false, {
    template_kind: 'message_2',
    messaging_cooldown_enabled: true,
    messaging_cooldown_hours: 2,
    navigation_delay_min_seconds: 0,
    navigation_delay_max_seconds: 0,
    composer_delay_min_seconds: 0,
    composer_delay_max_seconds: 0,
    typing_delay_min_ms: 0,
    typing_delay_max_ms: 0,
    between_targets_min_seconds: 0,
    between_targets_max_seconds: 0,
  })
  assert.ok(calls.some((url) => url.includes('kind=message_2')))
  assert.ok(calls.some((url) => url.includes('cooldownHours=2')))
  assert.ok(!calls.some((url) => url.includes('update-message')))
  assert.equal(calls.length, 2)
})

test('template macros render per target with fallbacks', () => {
  assert.equal(
    renderTemplate('Hey {matchedName}, I am {fullName} (@{userName})', {
      id: 'a',
      user_name: 'coltsportshq',
      full_name: 'Colt Sports',
      matched_name: 'Colt',
    }),
    'Hey Colt, I am Colt Sports (@coltsportshq)',
  )
  // Missing matched_name falls back to first word of full name.
  assert.equal(
    renderTemplate('{matchedName}?', {
      id: 'a',
      user_name: 'coltsportshq',
      full_name: 'Colt Sports',
      matched_name: null,
    }),
    'Colt?',
  )
  // Missing names fall back to username; never leaks the literal macro.
  assert.equal(
    renderTemplate('{matchedName}?', { id: 'a', user_name: 'coltsportshq' }),
    'coltsportshq?',
  )
})
test('successful send marks the recipient messaged', async () => {
  const calls = database()
  const composer = {
    waitFor: async () => {},
    click: async () => {},
    isVisible: async () => false,
    pressSequentially: async () => {},
    press: async () => {},
    inputValue: async () => {
      throw new Error('not an input')
    },
    textContent: async () => '',
  }
  const page = {
    goto: async () => {},
    locator: () => ({
      count: async () => 1,
      nth: () => ({ isVisible: async () => true, click: async () => {} }),
      last: () => composer,
    }),
  } as unknown as Page
  await sendMessages(page, 'profile', () => {}, () => false, {
    navigation_delay_min_seconds: 0,
    navigation_delay_max_seconds: 0,
    composer_delay_min_seconds: 0,
    composer_delay_max_seconds: 0,
    typing_delay_min_ms: 0,
    typing_delay_max_ms: 0,
    between_targets_min_seconds: 0,
    between_targets_max_seconds: 0,
  })
  assert.ok(calls.some((url) => url.includes('update-message')))
})
