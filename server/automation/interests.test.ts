import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { interestCommands, rewriteInterest, INTEREST_MODEL } from './interests.js'
import type { CommandRequest, CommandResponse } from '../worker/commands.js'

test('normal Luna rewrites an interest as reviewable content intent and preserves exclusions', async () => {
  const description =
    'Practical tutorials on building an e-commerce business and earning income online, excluding trading.'
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, INTEREST_MODEL)
    assert.equal(body.model, 'openai/gpt-6-luna')
    assert.deepEqual(JSON.parse(body.messages[1].content), {
      interest: 'how to make money online with ecom, no trading',
    })
    assert.match(body.messages[0].content, /Preserve exclusions/)
    assert.match(body.messages[0].content, /untrusted data/)
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ description }) } }],
    })
  }
  assert.equal(
    await rewriteInterest(' how to make money online with ecom, no trading ', {
      key: 'test',
      fetcher,
    }),
    description,
  )
})

test('invalid and truncated rewrites cannot become saved matching descriptions', async () => {
  for (const content of [
    '{}',
    '{',
    JSON.stringify({ description: '' }),
    JSON.stringify({ description: 'x'.repeat(1001) }),
  ])
    await assert.rejects(
      rewriteInterest('fishing', {
        key: 'test',
        fetcher: async () =>
          Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] }),
      }),
    )
  await assert.rejects(
    rewriteInterest('fishing', {
      key: 'test',
      fetcher: async () =>
        Response.json({
          choices: [{ finish_reason: 'length', message: { content: '{"description":"Fishing"}' } }],
        }),
    }),
  )
  await assert.rejects(
    rewriteInterest('fishing', {
      key: 'test',
      fetcher: async () => new Response('private upstream data', { status: 502 }),
    }),
    (error) => error instanceof Error && !error.message.includes('private upstream data'),
  )
})

test('the worker rejects invalid tags before AI, and returns only the rewritten description', async () => {
  let calls = 0
  const operation = interestCommands(async (label) => {
    calls++
    assert.equal(label, 'fishing')
    return 'Fishing techniques and catches.'
  }).operations[0]!
  const response = Object.assign(new EventEmitter(), {
    json: (value: unknown) => value,
  }) as unknown as CommandResponse
  for (const label of [null, '', ' ', 'x'.repeat(301)])
    await assert.rejects(async () =>
      operation.handler({ body: { label } } as CommandRequest, response, () => {}),
    )
  assert.equal(calls, 0)
  let result: unknown
  response.json = (value) => {
    result = value
    return response
  }
  await operation.handler({ body: { label: 'fishing' } } as CommandRequest, response, () => {})
  assert.deepEqual(result, { description: 'Fishing techniques and catches.' })
  assert.equal(calls, 1)
  assert.equal(response.listenerCount('close'), 0)
})
