import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { UnsupportedHumanizeSelectorError } from 'cloakbrowser/human'
import { dismissPopups } from './navigation.js'
import { BrowseSession, SessionEnded } from './session.js'

const consentLabels = [
  'Decline optional cookies', 'Get started', 'Use free of charge with ads',
  'Continue', 'Agree', 'Switch to less-personalized ads', 'OK',
]

function mockConsentLocator<T extends object>(selector: string, control: (label: string) => T) {
  const label = consentLabels.find(value => selector.includes(`:has-text(${JSON.stringify(value)})`))
  if (!label) return { count: async () => 0 }
  assert.match(selector, /^button:has-text\(/)
  const item = {
    innerText: async () => label,
    getByText: (text: string, { exact }: { exact: boolean }) => ({ count: async () => Number(exact && text === label) }),
    ...control(label),
  }
  return { count: async () => 1, nth: () => item }
}

test('feed popup handling completes Instagram consent with fewer optional choices', async () => {
  const clicks: string[] = []
  let screen = 'cookies'
  let freeSelected = false
  let lessSelected = false
  const visible = (label: string) => ({
    cookies: ['Decline optional cookies'],
    intro: ['Get started'],
    choice: ['Use free of charge with ads', 'Continue'],
    agreement: ['Agree', 'free-agreement'],
    experience: ['Switch to less-personalized ads', 'OK'],
    home: [],
  })[screen]?.includes(label) ?? false
  const control = (label: string) => ({
    count: async () => Number(visible(label)),
    nth: () => control(label),
    first: () => control(label),
    isVisible: async () => visible(label),
    isEnabled: async () => label === 'Continue' ? freeSelected : label === 'OK' ? lessSelected : true,
    innerText: async () => label === 'Use free of charge with ads' ? `${label}\nSome description` : label,
    click: async () => {
      assert.equal(visible(label), true)
      clicks.push(label)
      if (label === 'Decline optional cookies') screen = 'intro'
      else if (label === 'Get started') screen = 'choice'
      else if (label === 'Use free of charge with ads') freeSelected = true
      else if (label === 'Continue') screen = 'agreement'
      else if (label === 'Agree') screen = 'experience'
      else if (label === 'Switch to less-personalized ads') lessSelected = true
      else if (label === 'OK') screen = 'home'
    },
  })
  const page = {
    url: () => screen === 'home' ? 'https://www.instagram.com/' : 'https://www.instagram.com/consent/?flow=ad_free_subscription',
    getByRole: () => { throw new Error('Cloak humanized clicks cannot use role selectors') },
    getByText: (name: string | RegExp) => control(typeof name === 'string' ? name : 'free-agreement'),
    locator: (selector: string) => mockConsentLocator(selector, control),
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), true)
  assert.deepEqual(clicks, [
    'Decline optional cookies', 'Get started', 'Use free of charge with ads',
    'Continue', 'Agree', 'Switch to less-personalized ads', 'OK',
  ])
})

test('dismisses a notification popup after leaving consent', async () => {
  const clicks: string[] = []
  let onConsent = true
  let notificationOpen = true
  const popup = {
    waitForElementState: async () => { assert.equal(notificationOpen, false) },
    dispose: async () => {},
  }
  const control = (label: string) => ({
    count: async () => Number(label === 'Not Now' && !onConsent && notificationOpen),
    nth: () => control(label),
    first: () => control(label),
    isVisible: async () => label === 'Decline optional cookies' ? onConsent : label === 'Not Now' && !onConsent && notificationOpen,
    isEnabled: async () => true,
    locator: () => ({ count: async () => 1, elementHandle: async () => popup }),
    click: async () => {
      clicks.push(label)
      if (label === 'Decline optional cookies') onConsent = false
      if (label === 'Not Now') notificationOpen = false
    },
  })
  const page = {
    url: () => onConsent ? 'https://www.instagram.com/consent/' : 'https://www.instagram.com/',
    getByRole: (_role: string, { name }: { name: string }) => control(name),
    getByText: (name: string | RegExp) => control(typeof name === 'string' ? name : 'free-agreement'),
    locator: (selector: string) => selector.includes('Not Now') ? control('Not Now') : mockConsentLocator(selector, control),
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), true)
  assert.deepEqual(clicks, ['Decline optional cookies', 'Not Now'])
})

test('Get started heading does not compete with its button', async () => {
  let onConsent = true
  let clicked = false
  const hidden = { isVisible: async () => false, isEnabled: async () => true }
  const page = {
    url: () => onConsent ? 'https://www.instagram.com/consent/' : 'https://www.instagram.com/',
    getByText: (text: string) => text === 'Get started'
      ? { count: async () => 2, isVisible: async () => true, click: async () => { throw new Error('strict mode violation') } }
      : hidden,
    locator: (selector: string) => mockConsentLocator(selector, label => ({
      isVisible: async () => label === 'Get started',
      isEnabled: async () => true,
      click: async () => { clicked = true; onConsent = false },
    })),
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), true)
  assert.equal(clicked, true)
})

test('Continue heading does not compete with its button', async () => {
  let selected = false
  let continued = false
  const page = {
    url: () => continued ? 'https://www.instagram.com/' : 'https://www.instagram.com/consent/',
    getByText: (text: string) => text === 'Continue'
      ? { count: async () => 2, click: async () => { throw new Error('strict mode violation') } }
      : { first: () => ({ isVisible: async () => false }) },
    locator: (selector: string) => mockConsentLocator(selector, label => ({
      isVisible: async () => ['Use free of charge with ads', 'Continue'].includes(label),
      isEnabled: async () => label !== 'Continue' || selected,
      click: async () => {
        if (label === 'Use free of charge with ads') selected = true
        if (label === 'Continue') continued = true
      },
    })),
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), true)
  assert.equal(selected, true)
  assert.equal(continued, true)
})

test('consent skips hidden and nonexact controls before clicking Agree', async () => {
  const clicks: string[] = []
  let onConsent = true
  const hidden = { isVisible: async () => false }
  const candidate = (text: string, hasAgreeChild = false) => ({
    isVisible: async () => true,
    isEnabled: async () => true,
    innerText: async () => text,
    getByText: (label: string, { exact }: { exact: boolean }) => ({
      count: async () => Number(exact && (label === text || (hasAgreeChild && label === 'Agree'))),
    }),
    click: async () => { clicks.push(text); onConsent = false },
  })
  const page = {
    url: () => onConsent ? 'https://www.instagram.com/consent/' : 'https://www.instagram.com/',
    getByText: () => ({ first: () => ({ isVisible: async () => true }) }),
    locator: (selector: string) => selector.includes(':has-text("Agree")')
      ? { count: async () => 4, nth: (i: number) => [hidden, candidate('Disagree'), candidate('Agree to terms', true), candidate('Agree')][i] }
      : { count: async () => 0 },
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), true)
  assert.deepEqual(clicks, ['Agree'])
})

test('Not Now click does not report success while the popup remains', async () => {
  let clicks = 0
  const popup = {
    waitForElementState: async () => { throw new Error('popup still visible') },
    dispose: async () => {},
  }
  const button = {
    count: async () => 1,
    nth: () => button,
    isVisible: async () => true,
    locator: () => ({ count: async () => 1, elementHandle: async () => popup }),
    click: async () => { clicks++ },
  }
  const page = {
    url: () => 'https://www.instagram.com/',
    getByText: () => { throw new Error('text alone is not a popup control') },
    locator: () => button,
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), false)
  assert.equal(clicks, 1)
})

test('Not Now checks the clicked dialog when button indexes shift', async () => {
  let firstPresent = true
  const popup = {
    waitForElementState: async () => { throw new Error('clicked dialog remains open') },
    dispose: async () => {},
  }
  const hidden = { isVisible: async () => false }
  const first = {
    isVisible: async () => true,
    locator: () => ({ count: async () => 1, elementHandle: async () => popup }),
    click: async () => { firstPresent = false },
  }
  const buttons = {
    count: async () => 2,
    nth: (i: number) => firstPresent ? [first, hidden][i] : [hidden][i] ?? hidden,
  }
  const page = {
    url: () => 'https://www.instagram.com/',
    locator: () => buttons,
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), false)
})

test('Not Now checks visible controls beyond three hidden matches', async () => {
  let open = true
  let clicks = 0
  const popup = {
    waitForElementState: async () => { assert.equal(open, false) },
    dispose: async () => {},
  }
  const hidden = { isVisible: async () => false }
  const visible = {
    isVisible: async () => true,
    locator: () => ({ count: async () => 1, elementHandle: async () => popup }),
    click: async () => { clicks++; open = false },
  }
  const buttons = { count: async () => 4, nth: (i: number) => i === 3 ? visible : hidden }
  const page = {
    url: () => 'https://www.instagram.com/',
    locator: () => buttons,
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), true)
  assert.equal(clicks, 1)
})

test('Not Now does not count a detached button as a closed popup without its dialog', async () => {
  let clicks = 0
  const button = {
    isVisible: async () => true,
    locator: () => ({ elementHandle: async () => null }),
    click: async () => { clicks++ },
  }
  const page = {
    url: () => 'https://www.instagram.com/',
    locator: () => ({ count: async () => 1, nth: () => button }),
  } as unknown as Page

  assert.equal(await dismissPopups(page), false)
  assert.equal(clicks, 0)
})

test('does not wait after the final consent click leaves the consent page', async () => {
  let onConsent = true
  const control = (label: string) => ({
    count: async () => 0,
    first: () => control(label),
    isVisible: async () => label === 'Decline optional cookies' && onConsent,
    isEnabled: async () => true,
    click: async () => { onConsent = false },
  })
  const page = {
    url: () => onConsent ? 'https://www.instagram.com/consent/' : 'https://www.instagram.com/',
    getByRole: (_role: string, { name }: { name: string }) => control(name),
    getByText: (name: string) => control(name),
    locator: (selector: string) => mockConsentLocator(selector, control),
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => { throw new SessionEnded('Deadline reached') }

  assert.equal(await dismissPopups(page, session), true)
  assert.equal(onConsent, false)
})

test('does not confirm an enabled Continue without choosing free ads', async () => {
  const clicks: string[] = []
  const control = (label: string) => ({
    isVisible: async () => label === 'Continue',
    isEnabled: async () => true,
    click: async () => { clicks.push(label) },
  })
  const page = {
    url: () => 'https://www.instagram.com/consent/',
    getByRole: (_role: string, { name }: { name: string }) => control(name),
    getByText: (name: string | RegExp) => ({ ...control(String(name)), first: () => control(String(name)) }),
    locator: (selector: string) => mockConsentLocator(selector, control),
  } as unknown as Page
  const session = new BrowseSession(Date.now() + 100)

  await assert.rejects(dismissPopups(page, session), SessionEnded)
  assert.deepEqual(clicks, [])
})

test('resumes at the verified free-ads agreement screen', async () => {
  const clicks: string[] = []
  let screen = 'agreement'
  let lessSelected = false
  const visible = (label: string) =>
    screen === 'agreement' ? ['Agree', 'free-agreement'].includes(label) :
    screen === 'experience' ? ['Switch to less-personalized ads', 'OK'].includes(label) : false
  const control = (label: string) => ({
    count: async () => 0,
    first: () => control(label),
    isVisible: async () => visible(label),
    isEnabled: async () => label !== 'OK' || lessSelected,
    click: async () => {
      clicks.push(label)
      if (label === 'Agree') screen = 'experience'
      else if (label === 'Switch to less-personalized ads') lessSelected = true
      else if (label === 'OK') screen = 'home'
    },
  })
  const page = {
    url: () => screen === 'home' ? 'https://www.instagram.com/' : 'https://www.instagram.com/consent/',
    getByRole: (_role: string, { name }: { name: string }) => control(name),
    getByText: (name: string | RegExp) => control(typeof name === 'string' ? name : 'free-agreement'),
    locator: (selector: string) => mockConsentLocator(selector, control),
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), true)
  assert.deepEqual(clicks, ['Agree', 'Switch to less-personalized ads', 'OK'])
})

test('a partial consent flow stops at the session deadline', async () => {
  const clicks: string[] = []
  const control = (label: string) => ({
    isVisible: async () => label === 'Decline optional cookies' && clicks.length === 0,
    isEnabled: async () => true,
    click: async () => { clicks.push(label) },
  })
  const page = {
    url: () => 'https://www.instagram.com/consent/',
    getByRole: (_role: string, { name }: { name: string }) => control(name),
    getByText: (name: string | RegExp) => ({ ...control(String(name)), first: () => control(String(name)) }),
    locator: (selector: string) => mockConsentLocator(selector, control),
  } as unknown as Page
  const session = new BrowseSession(Date.now() + 100)

  await assert.rejects(dismissPopups(page, session), SessionEnded)
  assert.deepEqual(clicks, ['Decline optional cookies'])
})

test('waits for consent controls that appear after more than 1.5 seconds', async () => {
  const clicks: string[] = []
  const visibleAt = Date.now() + 1_800
  let onConsent = true
  const control = (label: string) => ({
    count: async () => 0,
    first: () => control(label),
    isVisible: async () => label === 'Decline optional cookies' && onConsent && Date.now() >= visibleAt,
    isEnabled: async () => true,
    click: async () => {
      clicks.push(label)
      onConsent = false
    },
  })
  const page = {
    url: () => onConsent ? 'https://www.instagram.com/consent/' : 'https://www.instagram.com/',
    getByRole: (_role: string, { name }: { name: string }) => control(name),
    getByText: (name: string) => control(name),
    locator: (selector: string) => mockConsentLocator(selector, control),
  } as unknown as Page

  assert.equal(await dismissPopups(page, new BrowseSession(Date.now() + 8_000)), true)
  assert.deepEqual(clicks, ['Decline optional cookies'])
})

test('consent controls are ignored outside Instagram consent pages', async () => {
  const page = {
    url: () => 'https://www.instagram.com/',
    getByText: () => ({ count: async () => 0 }),
    locator: () => ({ count: async () => 0 }),
  } as unknown as Page
  assert.equal(await dismissPopups(page), false)
})

test('a Cloak selector failure during consent is reported instead of retried silently', async () => {
  const failure = new UnsupportedHumanizeSelectorError('internal:role=button')
  const page = {
    url: () => 'https://www.instagram.com/consent/',
    getByText: () => ({
      isVisible: async () => true,
      isEnabled: async () => true,
      click: async () => { throw failure },
    }),
    locator: (selector: string) => mockConsentLocator(selector, () => ({
      isVisible: async () => true,
      isEnabled: async () => true,
      click: async () => { throw failure },
    })),
  } as unknown as Page

  await assert.rejects(dismissPopups(page), error => error === failure)
})
