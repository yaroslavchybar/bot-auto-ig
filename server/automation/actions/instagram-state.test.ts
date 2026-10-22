import { visibleActionGeometry } from './action-locator.test-support.js'
import { errors } from 'playwright-core'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Page } from 'playwright-core'
import { assertInstagramReady, checkNotifications, hasUnreadNotifications } from './instagram-state.js'
import { BrowseSession } from './session.js'
import { dismissMetaAccountPopup, dismissPopups } from './navigation.js'

function metaAccountFixture(remainsOpen = false) {
  const window = new Window()
  window.document.body.innerHTML = '<div role="dialog" id="messages"><button>Close</button></div>' +
    '<div role="dialog" id="meta"><h2>Your Meta Account is here</h2>' +
    '<p>Your updated account works across Meta apps and devices</p>' +
    '<button id="close"><svg aria-label="Close"></svg></button><button>See what\'s new</button></div>'
  const clicks: string[] = []
  const visible = () => Boolean(window.document.querySelector('#meta:not([hidden])'))
  const handle = {
    waitForElementState: async () => {
      if (visible()) throw new errors.TimeoutError('The actual Meta popup stayed visible')
    },
    dispose: async () => {},
  }
  const close = {
    first() { return this }, filter() { return this }, isVisible: async () => visible(),
    elementHandle: async () => ({ ...visibleActionGeometry,
      hover: async () => { clicks.push('cursor-to-close') },
      click: async () => {
        clicks.push('meta-close')
        if (!remainsOpen) window.document.querySelector('#meta')?.remove()
      },
      dispose: async () => {},
    }),
  }
  const popup = {
    first() { return this }, filter() { return this }, isVisible: async () => visible(),
    elementHandle: async () => handle,
    getByText: (title: string, options: { exact: boolean }) => {
      assert.equal(title, 'Your Meta Account is here'); assert.equal(options.exact, true)
      return { first: () => ({ isVisible: async () => visible() }) }
    },
    locator: (selector: string) => {
      assert.match(selector, /aria-label="Close"/)
      assert.equal(selector.includes("See what's new"), false)
      return close
    },
  }
  const page = {
    url: () => 'https://www.instagram.com/',
    locator: (selector: string) => {
      if (selector.includes('Your Meta Account is here')) {
        assert.match(selector, /Your updated account works across Meta apps and devices/)
        assert.match(selector, /:not\(:has\(article, video\)\)/)
        return popup
      }
      if (selector.includes('Not Now')) return { count: async () => 0 }
      return { filter: () => ({ evaluateAll: async (fn: (boxes: Element[]) => unknown) => fn(
        Array.from(window.document.querySelectorAll(selector)).filter(node => !node.closest('[hidden]')) as unknown as Element[],
      ) }) }
    },
  } as unknown as Page
  return { window, page, clicks }
}

test('Meta announcement is closed before automation actions and during feed popup handling', async () => {
  for (const dismiss of [assertInstagramReady, dismissPopups]) {
    const fixture = metaAccountFixture()
    try {
      await dismiss(fixture.page, new BrowseSession())
      assert.deepEqual(fixture.clicks, ['meta-close'])
      assert.ok(fixture.window.document.querySelector('#messages'), 'Other dialogs stay open')
    } finally { await fixture.window.close() }
  }
})

test('Meta text in content or hidden dialogs is ignored and checkpoints take priority', async () => {
  for (const type of ['caption', 'hidden', 'checkpoint']) {
    const fixture = metaAccountFixture()
    try {
      const box = fixture.window.document.querySelector('#meta')!
      if (type === 'caption') box.innerHTML = `<article>${box.innerHTML}</article>`
      if (type === 'hidden') box.setAttribute('hidden', '')
      if (type === 'checkpoint') fixture.window.document.body.insertAdjacentHTML('beforeend', '<div role="alertdialog">Help us confirm it\'s you</div>')
      if (type === 'checkpoint') await assert.rejects(assertInstagramReady(fixture.page), /checkpoint needs attention/)
      else await assertInstagramReady(fixture.page)
      assert.deepEqual(fixture.clicks, [])
    } finally { await fixture.window.close() }
  }
})

test('Meta dismissal reports failure if the clicked popup remains visible', async () => {
  const fixture = metaAccountFixture(true)
  try {
    assert.equal(await dismissMetaAccountPopup(fixture.page), false)
    assert.deepEqual(fixture.clicks, ['meta-close'])
  } finally { await fixture.window.close() }
})

test('readiness fails when the Meta announcement cannot be dismissed', async () => {
  const fixture = metaAccountFixture(true)
  try {
    await assert.rejects(assertInstagramReady(fixture.page), /Instagram Meta account popup needs attention/)
    assert.deepEqual(fixture.clicks, ['meta-close'])
    assert.ok(fixture.window.document.querySelector('#meta'))
  } finally { await fixture.window.close() }
})

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

test('unread detection uses the visible Notifications badge, ignoring Messages and hidden markers', async () => {
  const window = new Window()
  try {
    const badge = '<div data-badge style="background: rgb(255, 48, 64); border-radius: 50px; visibility: visible; opacity: 1"></div>'
    for (const variant of ['unread', 'read', 'messages', 'hidden', 'offscreen', 'transparent', 'hidden-control', 'caption']) {
      window.document.body.innerHTML = `<a id="notifications" style="--ig-badge: 255, 48, 64"><div><svg aria-label="Notifications"></svg></div>${badge}</a>` +
        `<a><svg aria-label="Messages"></svg>${badge}</a><article>${badge}</article>`
      const control = window.document.querySelector('#notifications')!
      const dot = control.querySelector('[data-badge]')!
      if (['read', 'messages', 'caption'].includes(variant)) dot.remove()
      if (variant === 'hidden') dot.setAttribute('style', `${dot.getAttribute('style')}; visibility: hidden`)
      if (variant === 'transparent') dot.setAttribute('style', `${dot.getAttribute('style')}; opacity: 0`)
      if (variant === 'hidden-control') control.setAttribute('hidden', '')
      for (const node of window.document.querySelectorAll('[data-badge]')) {
        const top = variant === 'offscreen' ? -20 : 20
        node.getBoundingClientRect = () => ({ x: 40, y: top, left: 40, right: 51, top, bottom: top + 11,
          width: 11, height: 11, toJSON: () => ({}) })
      }
      const page = { locator: (selector: string) => ({ filter: () => ({
        evaluateAll: async (fn: (nodes: Element[]) => boolean) => fn(
          [...window.document.querySelectorAll(selector)].filter(node => !node.hasAttribute('hidden')) as unknown as Element[],
        ),
      }) }) } as unknown as Page
      assert.equal(await hasUnreadNotifications(page), variant === 'unread', variant)
    }
  } finally { await window.happyDOM.close() }
})

function notificationFixture(
  options: {
    failures?: number
    openedBeforeError?: boolean
    closeFailure?: boolean
    closedBeforeError?: boolean
    checkpoint?: boolean
    stubbornPanel?: boolean
    resetFailure?: boolean
    url?: string
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
      ...visibleActionGeometry, hover: async () => {},
      click: async () => {
        if (options.closedBeforeError) opened = false
        if (options.closeFailure) throw new Error('Element is not visible')
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
      if (options.stubbornPanel && state === 'hidden' && opened) throw new errors.TimeoutError('Panel stayed open')
      assert.equal(opened, state === 'visible')
    },
    locator: (selector: string) => {
      assert.ok(selector.startsWith('xpath=ancestor::'))
      return { getByRole: () => close }
    },
  }
  const page = {
    url: () => options.url ?? 'https://www.instagram.com/',
    keyboard: {
      press: async (key: string) => {
        assert.equal(key, 'Escape')
        clicks.push('escape')
        if (!options.stubbornPanel) opened = false
      },
    },
    goto: async (url: string) => {
      assert.equal(url, options.url ?? 'https://www.instagram.com/')
      if (options.resetFailure) throw new errors.TimeoutError('Home reset timed out')
      clicks.push('notification-reset'); opened = false
      return null
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
              ...visibleActionGeometry, hover: async () => {},
              click: async () => {
                if (options.openedBeforeError) opened = true
                if (selected <= (options.failures ?? 0))
                  throw new Error('Element is not visible')
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

test('a notification panel that survives Escape resets its current route without visiting Home', async () => {
  const f = notificationFixture({ closeFailure: true, stubbornPanel: true, url: 'https://www.instagram.com/reels/' })
  assert.equal(await checkNotifications(f.page, () => {}, f.session), true)
  assert.deepEqual(f.clicks, ['notifications', 'escape', 'notification-reset'])
})

test('a temporary notification cleanup failure skips the check instead of ending warm-up', async () => {
  const f = notificationFixture({ closeFailure: true, stubbornPanel: true, resetFailure: true })
  const notes: Record<string, unknown>[] = []
  assert.equal(await checkNotifications(f.page, note => notes.push(note), f.session), false)
  assert.equal(notes.at(-1)?.event, 'automation.warmup.notifications_skipped')
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
