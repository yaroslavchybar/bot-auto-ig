import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errors, type Page } from 'playwright-core'
import { readUnreadDms } from './unreadDms.js'

function pageWithBadge(label: string | null, loggedIn = true, badgeError?: Error): Page {
  const badge = {
    waitFor: async () => {
      if (badgeError) throw badgeError
      if (label === null) throw new errors.TimeoutError('No badge yet')
    },
    getAttribute: async () => label,
  }
  const inbox = {
    waitFor: async () => {
      if (!loggedIn) throw new Error('No inbox link')
    },
    locator: (selector: string) => {
      assert.equal(selector, '[aria-label^="Direct messaging - "]')
      return badge
    },
  }
  return {
    locator: (selector: string) => {
      assert.equal(selector, 'a[href="/direct/inbox/"]')
      return inbox
    },
  } as unknown as Page
}

test('reads the current Instagram DM badge and leaves a missing badge unknown', async () => {
  assert.equal(await readUnreadDms(pageWithBadge('Direct messaging - 6 new notifications link')), 6)
  assert.equal(await readUnreadDms(pageWithBadge('Direct messaging - 1,234 new notifications link')), 1234)
  assert.equal(await readUnreadDms(pageWithBadge(null)), null)
})

test('rejects compact badge values that are not exact counts', async () => {
  await assert.rejects(readUnreadDms(pageWithBadge('Direct messaging - 99+ new notifications link')), /unknown format/)
})

test('does not report zero when Instagram is logged out', async () => {
  await assert.rejects(readUnreadDms(pageWithBadge(null, false)), /No inbox link/)
})

test('propagates browser errors instead of reporting zero', async () => {
  await assert.rejects(readUnreadDms(pageWithBadge(null, true, new Error('Page closed'))), /Page closed/)
})
