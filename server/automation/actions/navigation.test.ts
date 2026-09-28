import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { dismissPopups } from './navigation.js'
import { BrowseSession, SessionEnded } from './session.js'

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
    getByRole: (_role: string, { name }: { name: string }) => control(name),
    getByText: (name: string | RegExp) => control(typeof name === 'string' ? name : 'free-agreement'),
    locator: () => ({ count: async () => 0 }),
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
  const control = (label: string) => ({
    count: async () => Number(label === 'Not Now' && !onConsent),
    nth: () => control(label),
    first: () => control(label),
    isVisible: async () => label === 'Decline optional cookies' ? onConsent : label === 'Not Now' && !onConsent,
    isEnabled: async () => true,
    click: async () => {
      clicks.push(label)
      if (label === 'Decline optional cookies') onConsent = false
    },
  })
  const page = {
    url: () => onConsent ? 'https://www.instagram.com/consent/' : 'https://www.instagram.com/',
    getByRole: (_role: string, { name }: { name: string }) => control(name),
    getByText: (name: string | RegExp) => control(typeof name === 'string' ? name : 'free-agreement'),
    locator: () => ({ count: async () => 0 }),
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}

  assert.equal(await dismissPopups(page, session), true)
  assert.deepEqual(clicks, ['Decline optional cookies', 'Not Now'])
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
    locator: () => ({ count: async () => 0 }),
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
    locator: () => ({ count: async () => 0 }),
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
    locator: () => ({ count: async () => 0 }),
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
    locator: () => ({ count: async () => 0 }),
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
    locator: () => ({ count: async () => 0 }),
  } as unknown as Page

  assert.equal(await dismissPopups(page, new BrowseSession(Date.now() + 8_000)), true)
  assert.deepEqual(clicks, ['Decline optional cookies'])
})

test('consent controls are ignored outside Instagram consent pages', async () => {
  const page = {
    url: () => 'https://www.instagram.com/',
    getByRole: () => ({ count: async () => 0 }),
    locator: () => ({ count: async () => 0 }),
  } as unknown as Page
  assert.equal(await dismissPopups(page), false)
})
