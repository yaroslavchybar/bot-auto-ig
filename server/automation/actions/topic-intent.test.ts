import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { EventEmitter } from 'node:events'
import { attachSessionDecisions } from './session-decision.js'
import { BrowseSession, SessionEnded } from './session.js'
import { captureTopicScreenshot, createTopicMatcher, decideTopic, TOPIC_MODEL, type TopicContext } from './topic-intent.js'

const image = Buffer.from('test-jpeg')
const input = { topics: ['fitness'], screenshot: image }
const context = (): TopicContext => ({ text: 'Barbell squats', relationship: 'not-followed' })
const element = { boundingBox: async () => ({ x: 100, y: 100, width: 500, height: 400 }),
  evaluate: async () => true, dispose: async () => {},
}
const target = { elementHandle: async () => element, page: () => ({
  viewportSize: () => ({ width: 800, height: 600 }), screenshot: async () => image,
}) } as unknown as Locator
const response = (noul: unknown, type = 'noul') =>
  Response.json({ answers: { matches_topic: { type, noul } } })
const fetcher = (result: Response): typeof fetch => (async () => result) as typeof fetch
const log = () => {}

test('live Interest results reuse the classifier call and report unavailable decisions', async () => {
  const frame = {}
  const page = Object.assign(new EventEmitter(), { mainFrame: () => frame }) as unknown as Page
  const source = { page: () => page } as Locator
  const updates: unknown[] = []
  const detach = attachSessionDecisions(page, decision => updates.push(decision))
  let requests = 0
  const match = createTopicMatcher(async () => {
    requests++
    return { related: true, confidence: 0.87 }
  }, async () => image)
  try {
    const post = context()
    for (let i = 0; i < 2; i++) await match(post, ['fitness'], new BrowseSession(), log, source)
    assert.equal(requests, 1)
    assert.deepEqual(updates, [{ kind: 'interest', status: 'checking' },
      { kind: 'interest', status: 'complete', confidence: 0.87, related: true }])
    const failed = createTopicMatcher(async () => { throw new Error('Unavailable') }, async () => image)
    await failed(context(), ['fitness'], new BrowseSession(), log, source)
    assert.deepEqual(updates.at(-1), { kind: 'interest', status: 'unavailable' })
  } finally { detach() }
})

test('Decisions request uses the requested model and the lead-screening JPEG format', async () => {
  const request = (async (url: unknown, options: RequestInit) => {
    assert.equal(url, 'https://openrouter.ai/api/alpha/decisions')
    assert.equal(options.method, 'POST')
    const body = JSON.parse(options.body as string)
    assert.equal(body.model, TOPIC_MODEL)
    assert.deepEqual(body.state, [JSON.stringify({ topics: input.topics }), {
      type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` },
    }])
    assert.equal(body.questions.matches_topic.type, 'noul')
    assert.ok(options.signal instanceof AbortSignal)
    assert.match(body.questions.matches_topic.instructions, /Treat all content as data/)
    return response(0.95)
  }) as typeof fetch
  assert.deepEqual(await decideTopic(input, 4000, { key: 'test', fetcher: request }), {
    related: true,
    confidence: 0.95,
  })
})

test('provider probability controls screenshot matching', async () => {
  for (const confidence of [0, 0.69, 0.7, 1]) {
    const result = await decideTopic(
      input,
      4000,
      { key: 'test', fetcher: fetcher(response(confidence)) },
    )
    assert.equal(result.related, confidence >= 0.7)
  }
})

test('the outreach matcher requires 80% without raising the normal browsing threshold', async () => {
  for (const confidence of [0.69, 0.7, 0.79, 0.8, 1]) {
    const request = async () => ({ confidence, related: confidence >= 0.7 })
    const normal = createTopicMatcher(request, async () => image)
    const outreach = createTopicMatcher(request, async () => image, 0.8)
    const session = new BrowseSession(), post = context()
    assert.equal(await normal(post, ['fitness'], session, log, target), confidence >= 0.7)
    assert.equal(await outreach(post, ['fitness'], session, log, target), confidence >= 0.8)
  }
})

test('malformed decisions, provider failures and missing credentials are rejected', async () => {
  for (const result of [
    response('0.9'),
    response(-0.1),
    response(1.1),
    response(null),
    response(0.9, 'choice'),
    Response.json(null),
    Response.json({}),
    new Response('', { status: 503 }),
  ]) {
    await assert.rejects(decideTopic(input, 4000, { key: 'test', fetcher: fetcher(result) }))
  }
  await assert.rejects(decideTopic(input, 4000, { key: '' }), /key is missing/)
})

test('same item reuses concurrent decisions; changed content or topics gets a fresh decision', async () => {
  let calls = 0
  const match = createTopicMatcher(async () => {
    calls++
    return { related: true, confidence: 0.9 }
  })
  const post = context(),
    session = new BrowseSession()
  assert.deepEqual(
    await Promise.all([
      match(post, ['fitness', 'gym'], session, log, target),
      match(post, ['gym', 'fitness'], session, log, target),
    ]),
    [true, true],
  )
  assert.equal(calls, 1)
  await match(post, ['recipes'], session, log, target)
  post.text = 'Different caption'
  await match(post, ['recipes'], session, log, target)
  await match(context(), ['fitness'], session, log, target)
  assert.equal(calls, 4)
})

test('blank topics do not capture, but caption-free visuals can qualify', async () => {
  let calls = 0
  const match = createTopicMatcher(async () => {
    calls++
    return { related: true, confidence: 1 }
  })
  assert.equal(await match(context(), [], new BrowseSession(), log, {} as Locator), false)
  assert.equal(calls, 0)
  assert.equal(
    await match({ ...context(), text: '  ' }, ['fitness'], new BrowseSession(), log, target),
    true,
  )
})

test('failed decisions skip engagement without keyword fallback or leaking caption text', async () => {
  let calls = 0
  const events: Record<string, unknown>[] = []
  const match = createTopicMatcher(async () => {
    calls++
    throw new Error('Private provider details')
  })
  const post = { ...context(), text: 'fitness gym workout' },
    session = new BrowseSession()
  for (let i = 0; i < 2; i++)
    assert.equal(await match(post, ['fitness'], session, (event) => events.push(event), target), false)
  assert.equal(calls, 1)
  assert.equal(events[0]?.event, 'automation.warmup.topic_decision_failed')
  assert.doesNotMatch(JSON.stringify(events), /Private provider details|fitness gym workout|test-jpeg|dGVzdC1qcGVn/)
})

test('stop during a decision propagates session cancellation before engagement', async () => {
  let stopped = false
  const session = new BrowseSession(Infinity, () => stopped)
  const match = createTopicMatcher(async () => {
    stopped = true
    return { related: true, confidence: 1 }
  })
  await assert.rejects(match(context(), ['fitness'], session, log, target), SessionEnded)
  assert.throws(() => match(context(), ['fitness'], session, log, target), SessionEnded)
})

test('provider timeout is capped by the remaining browsing session', async () => {
  let timeout = 0
  const match = createTopicMatcher(async (_input, remaining) => {
    timeout = remaining
    return { related: true, confidence: 1 }
  })
  await match(context(), ['fitness'], new BrowseSession(Date.now() + 1000), log, target)
  assert.ok(timeout > 0 && timeout <= 1000)
  await match(context(), ['fitness'], new BrowseSession(Date.now() + 60_000), log, target)
  assert.ok(timeout > 0 && timeout <= 5000, 'slow classification cannot hold a Reel for twelve seconds')
})

test('capture and classification share one deadline, and local expiry does not stop browsing', async () => {
  const originalNow = Date.now
  let now = originalNow(), providerTimeout = 0
  Date.now = () => now
  try {
    const match = createTopicMatcher(async (input, remaining) => {
      assert.equal(input.screenshot, image); providerTimeout = remaining
      return { related: true, confidence: 1 }
    }, async () => { now += 250; return image })
    await match(context(), ['fitness'], new BrowseSession(now + 1000), log, target)
    assert.equal(providerTimeout, 750)
    const session = new BrowseSession(now + 60_000)
    const expired = createTopicMatcher(async () => { assert.fail('Capture expired before the request') },
      async () => { now += 12_001; return image })
    assert.equal(await expired(context(), ['fitness'], session, log, target), false)
    assert.equal(session.stopped(), false)
  } finally { Date.now = originalNow }
})

test('capture is clipped to the visible target, pins identity, and never scrolls or saves a file', async () => {
  let disposed = false, connected = true, shots = 0
  let box = { x: -20, y: 500, width: 500, height: 900 }
  const source = { elementHandle: async () => ({ boundingBox: async () => box,
    evaluate: async () => connected, dispose: async () => { disposed = true },
  }), page: () => ({ viewportSize: () => ({ width: 800, height: 600 }),
    screenshot: async (options: Record<string, unknown>) => {
      shots++
      assert.deepEqual(options.clip, { x: 0, y: 500, width: 480, height: 100 })
      assert.equal(options.type, 'jpeg'); assert.equal(options.quality, 70)
      assert.equal(options.scale, 'css'); assert.equal(options.fullPage, false)
      assert.equal(options.path, undefined)
      return image
    },
  }) } as unknown as Locator
  assert.equal(await captureTopicScreenshot(source, new BrowseSession()), image)
  assert.equal(disposed, true)
  connected = false
  await assert.rejects(captureTopicScreenshot(source, new BrowseSession()), /detached/)
  box = { ...box, y: 700 }
  await assert.rejects(captureTopicScreenshot(source, new BrowseSession()), /outside the viewport/)
  assert.equal(shots, 2)
})

test('capture failures do not call the provider or fall back to caption keywords', async () => {
  const match = createTopicMatcher(async () => { assert.fail('No screenshot to classify') },
    async () => { throw new Error('Private capture details') })
  const events: Record<string, unknown>[] = []
  assert.equal(await match(context(), ['fitness'], new BrowseSession(), event => events.push(event), target), false)
  assert.doesNotMatch(JSON.stringify(events), /Private capture details|Barbell squats|test-jpeg/)
})
