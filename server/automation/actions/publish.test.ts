import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { BrowseSession, SessionEnded } from './session.js'
import { publishFeedPost } from './publish.js'

type Box = { x: number; y: number; width: number; height: number }
const box = (): Box => ({ x: 10, y: 10, width: 100, height: 20 })

class FakeItem {
  constructor(private owner: FakePage, private visible: () => boolean, private onClick?: () => void) {}
  async boundingBox(): Promise<Box | null> { return box() }
  async isVisible(): Promise<boolean> { return this.visible() }
  async click(_options?: unknown): Promise<void> { this.onClick?.() }
  async setInputFiles(files: FakePage['files'], _options?: unknown): Promise<void> { this.owner.files = [...files] }
  async waitFor(_options?: unknown): Promise<void> { if (!this.visible()) throw new Error('timeout') }
  async getAttribute(_name?: unknown): Promise<null> { return null }
  locator(selector: string): FakeLocator { return this.owner.locator(selector) }
  page(): FakePage { return this.owner }
}

class FakeLocator {
  constructor(private page: FakePage, private visible: () => boolean, private onClick?: () => void) {}
  async count(): Promise<number> { return this.visible() ? 1 : 0 }
  nth(_index?: unknown): FakeItem { return new FakeItem(this.page, this.visible, this.onClick) }
  first(): FakeItem { return new FakeItem(this.page, this.visible, this.onClick) }
  async isVisible(): Promise<boolean> { return this.visible() }
  async waitFor(_options?: unknown): Promise<void> { if (!this.visible()) throw new Error('timeout') }
  async click(_options?: unknown): Promise<void> { this.onClick?.() }
  async getAttribute(_name?: unknown): Promise<null> { return null }
  locator(selector: string): FakeLocator { return this.page.locator(selector) }
}

class FakePage {
  urlValue = 'https://www.instagram.com/'
  files: Array<{ name: string; mimeType: string; buffer: Buffer }> = []
  liked = false
  constructor(private resolve: (selector: string, page: FakePage) => { visible: () => boolean; onClick?: () => void }) {}
  url(): string { return this.urlValue }
  viewportSize(): { width: number; height: number } { return { width: 1280, height: 800 } }
  locator(selector: string): FakeLocator {
    const route = this.resolve(selector, this)
    return new FakeLocator(this, route.visible, route.onClick)
  }
  async waitForEvent(_event?: unknown, _options?: unknown): Promise<{ setFiles: (files: FakePage['files'], _options?: unknown) => Promise<void> }> {
    return { setFiles: async files => { this.files = [...files] } }
  }
  async waitForURL(_url?: unknown, _options?: unknown): Promise<void> {}
  keyboard = { press: async (_key?: unknown): Promise<void> => {} }
  mouse = { move: async (_x?: unknown, _y?: unknown): Promise<void> => {} }
}

const hidden = () => ({ visible: () => false })
const image = () => ({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpeg') })

test('publish rejects when the session already ended', async () => {
  const page = new FakePage(() => hidden()) as unknown as Page
  await assert.rejects(publishFeedPost(page, image(), () => {}, () => false,
    Date.now() - 1), SessionEnded)
})

test('publish stops when the Create button is missing', async () => {
  const logs: string[] = []
  const page = new FakePage((selector, fake) => {
    if (selector.includes('profile picture'))
      return { visible: () => true, onClick: () => { fake.urlValue = 'https://www.instagram.com/someone/' } }
    return hidden()
  }) as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}
  assert.equal(await publishFeedPost(page, image(), fields => logs.push(fields.message || ''), () => false,
    Infinity, session), false)
  assert.ok(logs.some(message => message.includes('no Create button')))
})

test('publish picks Post when Create opens the Post menu', async () => {
  const logs: string[] = []
  const state = { menu: false, created: false, shared: false }
  const profileUrl = 'https://www.instagram.com/nastya.rainyy/'
  const page = new FakePage((selector, fake) => {
    if (selector.includes('profile picture'))
      return { visible: () => true, onClick: () => { fake.urlValue = profileUrl } }
    if (selector.includes('Not Now')) return hidden()
    if (selector.includes('New post'))
      return { visible: () => true, onClick: () => { state.menu = true } }
    if (selector.includes('Live video')) return { visible: () => state.menu && !state.created }
    if (selector.includes('text=/^Post$/'))
      return { visible: () => state.menu && !state.created, onClick: () => { state.created = true } }
    if (selector.includes('Your post has been shared')) return { visible: () => state.shared }
    if (selector.includes('Create new post')) return { visible: () => state.created }
    if (selector.includes('Crop')) return { visible: () => fake.files.length > 0 }
    if (selector.includes('Edit')) return { visible: () => state.created }
    if (selector === 'div[role="dialog"]') return { visible: () => state.created }
    if (selector.includes('input[type="file"]')) return { visible: () => state.created }
    if (selector.includes('Original')) return { visible: () => fake.files.length > 0 }
    if (selector.includes('^Next$')) return { visible: () => state.created }
    if (selector.includes('^Share$')) return { visible: () => state.created, onClick: () => { state.shared = true } }
    if (selector.includes('^Done$')) return { visible: () => state.shared }
    if (selector.includes('/p/')) return { visible: () => true }
    if (selector.includes('Unlike')) return { visible: () => fake.liked }
    if (selector.includes('Like')) return { visible: () => !fake.liked, onClick: () => { fake.liked = true } }
    if (selector.includes('Close')) return { visible: () => true }
    return hidden()
  }) as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}
  assert.equal(await publishFeedPost(page, image(), fields => logs.push(fields.message || ''), () => false,
    Infinity, session), true)
  assert.equal((page as unknown as FakePage).files.length, 1)
  assert.ok(logs.some(message => message.includes('Post shared')))
})

test('publish uploads Original, shares, then likes the new post', async () => {
  const logs: string[] = []
  const state = { created: false, shared: false, profile: false }
  const profileUrl = 'https://www.instagram.com/nastya.rainyy/'
  const page = new FakePage((selector, fake) => {
    if (selector.includes('profile picture'))
      return { visible: () => true, onClick: () => { fake.urlValue = profileUrl; state.profile = true } }
    if (selector.includes('Not Now')) return hidden()
    if (selector.includes('New post'))
      return { visible: () => state.profile, onClick: () => { state.created = true } }
    if (selector.includes('Your post has been shared')) return { visible: () => state.shared }
    if (selector.includes('Create new post')) return { visible: () => state.created }
    if (selector.includes('Crop')) return { visible: () => fake.files.length > 0 }
    if (selector.includes('Edit')) return { visible: () => state.created }
    if (selector === 'div[role="dialog"]') return { visible: () => state.created }
    if (selector.includes('input[type="file"]')) return { visible: () => state.created }
    if (selector.includes('Original')) return { visible: () => fake.files.length > 0 }
    if (selector.includes('^Next$')) return { visible: () => state.created }
    if (selector.includes('^Share$')) return { visible: () => state.created, onClick: () => { state.shared = true } }
    if (selector.includes('^Done$')) return { visible: () => state.shared }
    if (selector.includes('/p/')) return { visible: () => true }
    if (selector.includes('Unlike')) return { visible: () => fake.liked }
    if (selector.includes('Like')) return { visible: () => !fake.liked, onClick: () => { fake.liked = true } }
    if (selector.includes('Close')) return { visible: () => true }
    return hidden()
  }) as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}
  assert.equal(await publishFeedPost(page, image(), fields => logs.push(fields.message || ''), () => false,
    Infinity, session), true)
  assert.deepEqual((page as unknown as FakePage).files.map(file => [file.name, file.mimeType, file.buffer.toString()]),
    [['photo.jpg', 'image/jpeg', 'jpeg']])
  assert.equal((page as unknown as FakePage).liked, true)
  assert.ok(logs.some(message => message.includes('Post shared')))
  assert.ok(logs.some(message => message.includes('Original ratio selected')))
  assert.ok(logs.some(message => message.includes('Liked own post')))
})
