import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTopicSearchTerms, generateTopicSearchTerms, TOPIC_SEARCH_MODEL } from './topic-search.js'
import { BrowseSession, SessionEnded } from './session.js'

test('normal Luna generates validated search phrases from a description using chat completions', async () => {
  const description = 'Strength training at home, excluding bodybuilding competitions'
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.ok(init?.signal)
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, TOPIC_SEARCH_MODEL)
    assert.equal(body.model, 'openai/gpt-6-luna')
    assert.deepEqual(JSON.parse(body.messages[1].content), { description })
    assert.equal(body.response_format.type, 'json_schema')
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content:
      JSON.stringify({ terms: [' Home workouts ', 'home workouts', 'Bodyweight  training'] }) } }] })
  }
  assert.deepEqual(await generateTopicSearchTerms(description, 1000, { key: 'test', fetcher }),
    ['home workouts', 'bodyweight training'])
})

test('invalid, refused and truncated provider results never become Instagram queries', async () => {
  for (const content of ['not JSON', '{}', '{"terms":[]}', '{"terms":[42]}', '{"terms":[" "]}',
    '{"terms":["#fitness"]}', JSON.stringify({ terms: ['x'.repeat(81)] }),
    JSON.stringify({ terms: Array(9).fill('fitness') })]) {
    await assert.rejects(generateTopicSearchTerms('fitness', 1000, { key: 'test',
      fetcher: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] }) }))
  }
  await assert.rejects(generateTopicSearchTerms('fitness', 1000, { key: 'test',
    fetcher: async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"terms":["fitness"]}' } }] }) }))
  await assert.rejects(generateTopicSearchTerms('fitness', 1000, { key: 'test',
    fetcher: async () => new Response('', { status: 503 }) }), /HTTP 503/)
})

test('generation shares concurrent work, reuses phrases, and regenerates edited descriptions or expired entries', async () => {
  let now = Date.now(), calls = 0
  const get = createTopicSearchTerms(async () => { calls++; return ['home workout'] }, () => now)
  const session = new BrowseSession(now + 200_000_000)
  const events: Record<string, unknown>[] = []
  const log = (event: Record<string, unknown>) => { events.push(event) }
  assert.deepEqual(await Promise.all([get('fitness', session, log), get(' fitness ', session, log)]),
    [['home workout'], ['home workout']])
  await get('fitness', session, log)
  assert.equal(calls, 1)
  await get('cooking', session, log)
  assert.equal(calls, 2)
  now += 86_400_001
  await get('fitness', session, log)
  assert.equal(calls, 3)
  assert.equal(events.length, 3)
})

test('a generation failure skips queries, cools down and retries without using the raw description', async () => {
  let now = Date.now(), calls = 0
  const get = createTopicSearchTerms(async () => {
    if (++calls === 1) throw new Error('Provider unavailable')
    return ['strength training']
  }, () => now)
  const session = new BrowseSession(now + 120_000)
  assert.deepEqual(await get('Fitness, but no competitions', session, () => {}), [])
  assert.deepEqual(await get('Fitness, but no competitions', session, () => {}), [])
  assert.equal(calls, 1)
  now += 60_001
  assert.deepEqual(await get('Fitness, but no competitions', session, () => {}), ['strength training'])
  assert.equal(calls, 2)
})

test('blank descriptions do not call Luna and stopped sessions never use generated phrases', async () => {
  let calls = 0, stopped = false
  const get = createTopicSearchTerms(async () => { calls++; stopped = true; return ['fitness'] })
  const session = new BrowseSession(Date.now() + 10_000, () => stopped)
  assert.deepEqual(await get(' ', session, () => {}), [])
  assert.equal(calls, 0)
  await assert.rejects(get('fitness', session, () => {}), SessionEnded)
})

test('profiles sharing generation retain separate deadlines', async () => {
  let complete!: (terms: readonly string[]) => void
  const get = createTopicSearchTerms(() => new Promise(resolve => { complete = resolve }))
  const pending = get('fitness', new BrowseSession(Date.now() + 10_000), () => {})
  await assert.rejects(get('fitness', new BrowseSession(Date.now() + 15), () => {}), SessionEnded)
  complete(['strength training'])
  assert.deepEqual(await pending, ['strength training'])
})
