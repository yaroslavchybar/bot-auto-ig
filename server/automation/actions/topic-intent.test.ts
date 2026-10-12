import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrowseSession, SessionEnded } from './session.js'
import { createTopicMatcher, decideTopic, TOPIC_MODEL, type TopicContext } from './topic-intent.js'

const input = { topics: ['fitness'], text: 'Barbell squats and progressive overload' }
const context = (): TopicContext => ({ text: input.text, relationship: 'not-followed' })
const response = (noul: unknown, type = 'noul') =>
  Response.json({ answers: { matches_topic: { type, noul } } })
const fetcher = (result: Response): typeof fetch => (async () => result) as typeof fetch
const log = () => {}

test('Decisions request uses the requested model and only topic/caption text', async () => {
  const request = (async (url: unknown, options: RequestInit) => {
    assert.equal(url, 'https://openrouter.ai/api/alpha/decisions')
    assert.equal(options.method, 'POST')
    const body = JSON.parse(options.body as string)
    assert.equal(body.model, TOPIC_MODEL)
    assert.deepEqual(body.state, [JSON.stringify({ topics: input.topics, content: input.text })])
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

test('provider probability controls matching even when the caption contains keywords', async () => {
  for (const confidence of [0, 0.69, 0.7, 1]) {
    const result = await decideTopic(
      { topics: ['fitness'], text: 'Chocolate cake #fitness' },
      4000,
      { key: 'test', fetcher: fetcher(response(confidence)) },
    )
    assert.equal(result.related, confidence >= 0.7)
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
      match(post, ['fitness', 'gym'], session, log),
      match(post, ['gym', 'fitness'], session, log),
    ]),
    [true, true],
  )
  assert.equal(calls, 1)
  await match(post, ['recipes'], session, log)
  post.text = 'Different caption'
  await match(post, ['recipes'], session, log)
  await match(context(), ['fitness'], session, log)
  assert.equal(calls, 4)
})

test('blank topics and blank content never request a decision', async () => {
  const match = createTopicMatcher(async () => {
    assert.fail('Unexpected provider request')
  })
  assert.equal(await match(context(), [], new BrowseSession(), log), false)
  assert.equal(
    await match({ ...context(), text: '  ' }, ['fitness'], new BrowseSession(), log),
    false,
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
    assert.equal(await match(post, ['fitness'], session, (event) => events.push(event)), false)
  assert.equal(calls, 1)
  assert.equal(events[0]?.event, 'automation.warmup.topic_decision_failed')
  assert.doesNotMatch(JSON.stringify(events), /Private provider details|fitness gym workout/)
})

test('stop during a decision propagates session cancellation before engagement', async () => {
  let stopped = false
  const session = new BrowseSession(Infinity, () => stopped)
  const match = createTopicMatcher(async () => {
    stopped = true
    return { related: true, confidence: 1 }
  })
  await assert.rejects(match(context(), ['fitness'], session, log), SessionEnded)
  assert.throws(() => match(context(), ['fitness'], session, log), SessionEnded)
})

test('provider timeout is capped by the remaining browsing session', async () => {
  let timeout = 0
  const match = createTopicMatcher(async (_input, remaining) => {
    timeout = remaining
    return { related: true, confidence: 1 }
  })
  await match(context(), ['fitness'], new BrowseSession(Date.now() + 1000), log)
  assert.ok(timeout > 0 && timeout <= 1000)
})
