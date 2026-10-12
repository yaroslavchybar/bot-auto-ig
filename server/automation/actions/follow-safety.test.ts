import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { performProfileFollow } from './follow-safety.js'

function setup(label = 'Following', privateAccount = false, disappears = false, timeout = false) {
  let clicked = false
  const calls: string[] = []
  const suggestion = { filter() { return this }, first() { return this }, isVisible: async () => disappears && !clicked }
  const page = {
    url: () => 'https://www.instagram.com/target/',
    getByText: (text: string | RegExp) => typeof text === 'string' ? suggestion : { isVisible: async () => privateAccount },
    locator: (selector: string) => selector.startsWith('xpath=') ? {
      innerText: async () => label, waitFor: async () => { if (timeout) throw new Error('Timeout 15000ms exceeded') },
    } : { filter: () => ({ evaluateAll: async () => null }) },
  } as unknown as Page
  const run = () => performProfileFollow(page, async () => true,
    async () => { clicked = true; calls.push('click') }, async () => { calls.push('confirmed') }, async reason => { calls.push(`pause:${reason}`) })
  return { calls, run }
}

test('normal follows and private requests are confirmed without pausing', async () => {
  for (const [label, privateAccount] of [['Following', false], ['Requested', true]] as const) {
    const s = setup(label, privateAccount); assert.equal(await s.run(), true)
    assert.deepEqual(s.calls, ['click', 'confirmed'])
  }
})

test('Requested without private-account evidence stops further follows', async () => {
  const s = setup('Requested'); assert.equal(await s.run(), false)
  assert.ok(s.calls.some(call => call.startsWith('pause:'))); assert.ok(!s.calls.includes('confirmed'))
})

test('a stuck follow confirmation is paused without a second click', async () => {
  const s = setup('Follow', false, false, true); assert.equal(await s.run(), false)
  assert.equal(s.calls.filter(call => call === 'click').length, 1)
  assert.ok(s.calls.some(call => call.startsWith('pause:')))
})

test('a disappearing suggestions panel pauses after recording the successful follow', async () => {
  const s = setup('Following', false, true); assert.equal(await s.run(), true)
  assert.equal(s.calls[1], 'confirmed'); assert.ok(s.calls[2].startsWith('pause:'))
})
