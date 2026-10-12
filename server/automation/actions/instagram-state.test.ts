import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Page } from 'playwright-core'
import { assertInstagramReady, checkNotifications } from './instagram-state.js'
import { BrowseSession } from './session.js'
import { ElementNotVisibleError } from 'cloakbrowser/human'

test('Instagram warnings ignore content and hidden alerts but stop on visible limits', async () => {
  const window = new Window()
  try {
    const page = {
      url: () => 'https://www.instagram.com/',
      locator: (selector: string) => ({
        filter: () => ({
          evaluateAll: async (fn: (elements: Element[]) => unknown) =>
            fn(
              Array.from(window.document.querySelectorAll(selector)).filter(
                (element) => !element.closest('[hidden]'),
              ) as unknown as Element[],
            ),
        }),
      }),
    } as unknown as Page
    for (const html of [
      '<article>Try again later</article>',
      '<div role="dialog"><article>Unusual activity <video></video></article></div>',
      '<div role="alert" hidden>Action blocked</div>',
      '<div role="dialog">Turn on notifications</div>',
    ]) {
      window.document.body.innerHTML = html
      await assertInstagramReady(page)
    }
    window.document.body.innerHTML = '<div role="alert">We limit how often you can do this</div>'
    await assert.rejects(assertInstagramReady(page), /Instagram limit needs attention/)
    window.document.body.innerHTML = '<div role="alertdialog">Help us confirm it\'s you</div>'
    await assert.rejects(assertInstagramReady(page), /Instagram checkpoint needs attention/)
  } finally {
    await window.happyDOM.close()
  }
})

test('login and checkpoint URLs stop before any DOM action', async () => {
  for (const path of [
    '/accounts/login/',
    '/challenge/123/',
    '/checkpoint/',
    '/accounts/suspended/',
  ])
    await assert.rejects(
      assertInstagramReady({ url: () => `https://www.instagram.com${path}` } as Page),
      /needs attention/,
    )
})

function notificationFixture(
  options: {
    failures?: number
    openedBeforeError?: boolean
    closeFailure?: boolean
    closedBeforeError?: boolean
    checkpoint?: boolean
  } = {},
) {
  const clicks: string[] = []
  let opened = false,
    selections = 0
  const close = {
    filter() {
      return this
    },
    first() {
      return this
    },
    isVisible: async () => opened,
    elementHandle: async () => ({
      hover: async () => {},
      click: async () => {
        if (options.closedBeforeError) opened = false
        if (options.closeFailure) throw new ElementNotVisibleError('<ElementHandle>')
        clicks.push('notification-close')
        opened = false
      },
      dispose: async () => {},
    }),
  }
  const heading = {
    filter() {
      return this
    },
    first() {
      return this
    },
    isVisible: async () => opened,
    waitFor: async ({ state }: { state: string }) => {
      assert.equal(opened, state === 'visible')
    },
    locator: (selector: string) => {
      assert.ok(selector.startsWith('xpath=ancestor::'))
      return { getByRole: () => close }
    },
  }
  const page = {
    url: () => 'https://www.instagram.com/',
    keyboard: {
      press: async (key: string) => {
        assert.equal(key, 'Escape')
        clicks.push('escape')
        opened = false
      },
    },
    locator: (selector: string) => {
      if (selector.includes('svg[aria-label="Notifications"]'))
        return {
          filter({ visible }: { visible: boolean }) {
            assert.equal(visible, true)
            return this
          },
          first() {
            return this
          },
          isVisible: async () => !opened,
          elementHandle: async () => {
            const selected = ++selections
            return {
              hover: async () => {},
              click: async () => {
                if (options.openedBeforeError) opened = true
                if (selected <= (options.failures ?? 0))
                  throw new ElementNotVisibleError('<ElementHandle>')
                clicks.push('notifications')
                opened = true
              },
              dispose: async () => {},
            }
          },
        }
      return {
        filter: () => ({ evaluateAll: async () => (options.checkpoint ? 'checkpoint' : null) }),
      }
    },
    getByRole: (role: string) => {
      if (role === 'heading') return heading
      throw new Error('Must not select expanded link names or a global Close button')
    },
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}
  return { page, session, clicks, selections: () => selections }
}

test('notification checks use stable icons and close their own panel instead of a DM composer', async () => {
  const { page, session, clicks } = notificationFixture()
  assert.equal(await checkNotifications(page, () => {}, session), true)
  assert.deepEqual(clicks, ['notifications', 'notification-close'])
})

test('notification navigation reacquires a hidden control once without blocking warm-up', async () => {
  const f = notificationFixture({ failures: 1 })
  assert.equal(await checkNotifications(f.page, () => {}, f.session), true)
  assert.equal(f.selections(), 2)
  assert.deepEqual(f.clicks, ['notifications', 'notification-close'])
})

test('a click that opened notifications before its element disappeared is not repeated', async () => {
  const f = notificationFixture({ failures: 1, openedBeforeError: true })
  assert.equal(await checkNotifications(f.page, () => {}, f.session), true)
  assert.equal(f.selections(), 1)
  assert.deepEqual(f.clicks, ['notification-close'])
})

test('repeated notification visibility failures skip the optional check after two attempts', async () => {
  const f = notificationFixture({ failures: 10 })
  assert.equal(await checkNotifications(f.page, () => {}, f.session), false)
  assert.equal(f.selections(), 2)
  assert.deepEqual(f.clicks, [])
})

test('a notification close control that disappears falls back to Escape', async () => {
  const f = notificationFixture({ closeFailure: true })
  assert.equal(await checkNotifications(f.page, () => {}, f.session), true)
  assert.deepEqual(f.clicks, ['notifications', 'escape'])
})

test('visibility recovery never ignores an Instagram checkpoint', async () => {
  const f = notificationFixture({ failures: 1, checkpoint: true })
  await assert.rejects(
    checkNotifications(f.page, () => {}, f.session),
    /checkpoint needs attention/,
  )
  assert.equal(f.selections(), 1)
})

test('a close that already dismissed notifications never sends Escape to another overlay', async () => {
  const f = notificationFixture({ closeFailure: true, closedBeforeError: true })
  assert.equal(await checkNotifications(f.page, () => {}, f.session), true)
  assert.deepEqual(f.clicks, ['notifications'])
})
