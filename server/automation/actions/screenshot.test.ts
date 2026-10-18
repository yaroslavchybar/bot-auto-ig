import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import type { Page } from 'playwright-core'
import { captureViewportScreenshot } from './screenshot.js'
import { BrowseSession, SessionEnded } from './session.js'

async function fixture(width = 800, height = 600) {
  const image = await sharp({ create: { width, height, channels: 3, background: '#123456' } })
    .png()
    .toBuffer()
  const commands: string[] = []
  let detached = 0
  const cdp = {
    send: async (command: string, options: Record<string, unknown>) => {
      commands.push(command)
      assert.equal(command, 'Page.captureScreenshot')
      assert.deepEqual(options, { format: 'png', fromSurface: false, captureBeyondViewport: false })
      return { data: image.toString('base64') }
    },
    detach: async () => {
      detached++
    },
  }
  const context = { newCDPSession: async () => cdp }
  const page = {
    context: () => context,
    viewportSize: () => ({ width: 800, height: 600 }),
    screenshot: () => {
      throw new Error('Playwright screenshot introduces a compositor clip')
    },
    evaluate: () => {
      throw new Error('Capture must not modify DOM or browser metrics')
    },
  } as unknown as Page
  return { page, context, cdp, image, commands, detached: () => detached }
}

test('view capture never clips, changes metrics, modifies styles or uses Playwright screenshots', async () => {
  const s = await fixture()
  assert.deepEqual(await captureViewportScreenshot(s.page, new BrowseSession()), s.image)
  assert.deepEqual(s.commands, ['Page.captureScreenshot'])
  assert.equal(s.detached(), 1)
})

test('native display pixels are normalized to CSS viewport pixels in memory', async () => {
  const s = await fixture(1600, 1200)
  const metadata = await sharp(
    await captureViewportScreenshot(s.page, new BrowseSession()),
  ).metadata()
  assert.equal(metadata.width, 800)
  assert.equal(metadata.height, 600)
  assert.equal(metadata.format, 'png')
  assert.equal(s.detached(), 1)
})

test('a capture with a different viewport shape fails instead of cropping the wrong pixels', async () => {
  const s = await fixture(800, 500)
  await assert.rejects(captureViewportScreenshot(s.page, new BrowseSession()), /dimensions/)
  assert.equal(s.detached(), 1)
})

test('a failed capture detaches without falling back to a clipped screenshot', async () => {
  const s = await fixture()
  s.cdp.send = async () => {
    throw new Error('Capture failed')
  }
  await assert.rejects(captureViewportScreenshot(s.page, new BrowseSession()), /Capture failed/)
  assert.equal(s.detached(), 1)
})

test('cancellation after attaching prevents capture and releases the session', async () => {
  const s = await fixture()
  let stopped = false
  s.context.newCDPSession = async () => {
    stopped = true
    return s.cdp
  }
  await assert.rejects(
    captureViewportScreenshot(s.page, new BrowseSession(Infinity, () => stopped)),
    SessionEnded,
  )
  assert.deepEqual(s.commands, [])
  assert.equal(s.detached(), 1)
})

test('late attachment after timeout detaches and never starts a screenshot', async () => {
  const s = await fixture()
  let resolve!: (session: typeof s.cdp) => void
  s.context.newCDPSession = () =>
    new Promise((done) => {
      resolve = done
    })
  const session = new BrowseSession(Date.now() + 30)
  await assert.rejects(captureViewportScreenshot(s.page, session), /timed out|session ended/)
  resolve(s.cdp)
  await new Promise((done) => setTimeout(done, 0))
  assert.deepEqual(s.commands, [])
  assert.equal(s.detached(), 1)
})

test('a stalled capture times out and detaches its CDP session', async () => {
  const s = await fixture()
  s.cdp.send = () => new Promise(() => {})
  await assert.rejects(
    captureViewportScreenshot(s.page, new BrowseSession(Date.now() + 30)),
    /timed out/,
  )
  assert.equal(s.detached(), 1)
})
