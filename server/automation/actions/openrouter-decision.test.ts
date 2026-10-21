import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentLogScope, logOperation, type LogScope } from '../../shared/logger.js'
import { DecisionRefusedError, requestOpenRouterDecision } from './openrouter-decision.js'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x02, 0xa3, 0x04, 0xb0,
  3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9])
const input = { kind: 'topic' as const, model: 'fixture-model', screenshot: jpeg, timeout: 1000,
  key: 'fixture-openrouter-secret', errorPrefix: 'Topic provider',
  payload: { questions: { matches_topic: {} }, image: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }

function fixture(response: Response) {
  let scope: LogScope | undefined
  const fetcher = (async () => { scope = currentLogScope(); return response.clone() }) as typeof fetch
  return { fetcher, scope: () => { assert.ok(scope?.completed); return scope } }
}

test('request diagnostics retain image metadata and parent correlation without the request image', async () => {
  const f = fixture(Response.json({ answers: { matches_topic: { type: 'noul', noul: 0.8 } } },
    { headers: { 'x-request-id': 'provider-request', 'x-generation-id': 'generation' } }))
  await logOperation('recipient', { targetUsername: 'target', leadId: 'lead', profileId: 'profile' }, async parent => {
    await requestOpenRouterDecision({ ...input, fetcher: f.fetcher })
    const scope = f.scope()
    assert.equal(scope.requestId, parent.requestId)
    assert.equal(scope.parentOperationId, parent.operationId)
    assert.equal(scope.fields.targetUsername, 'target')
    assert.equal(scope.fields.leadId, 'lead')
    assert.equal(scope.fields.imageBytes, jpeg.length)
    assert.equal(scope.fields.imageWidth, 1200)
    assert.equal(scope.fields.imageHeight, 675)
    assert.equal(scope.fields.imageHasJpegEnd, true)
    assert.equal(scope.fields.providerRequestId, 'provider-request')
    assert.equal(scope.fields.generationId, 'generation')
    assert.deepEqual(scope.fields.answerTypes, { matches_topic: 'noul' })
    assert.ok(Number(scope.fields.requestBytes) > jpeg.length)
    assert.ok(!JSON.stringify(scope.safeFields(scope.fields)).includes(jpeg.toString('base64')))
  })
})

test('HTTP errors retain sanitized upstream details, status and retry timing', async () => {
  const f = fixture(Response.json({ error: { code: 502, message: `Bad image data:image/jpeg;base64,${jpeg.toString('base64')}`,
    metadata: { provider_name: 'Fixture', error_type: 'invalid_image', provider_code: 'bad_image',
      raw: JSON.stringify({ error: { message: `upstream echoed ${input.key} ${jpeg.toString('base64')}`, code: 'decode_error' },
        request: input.payload }) } } }, { status: 502, headers: { 'retry-after': '30', 'cf-ray': 'ray' } }))
  await assert.rejects(requestOpenRouterDecision({ ...input, fetcher: f.fetcher }), /HTTP 502/)
  const scope = f.scope(), fields = scope.fields
  assert.equal(fields.httpStatus, 502)
  assert.equal(fields.failureKind, 'http')
  assert.equal(fields.providerName, 'Fixture')
  assert.equal(fields.providerErrorType, 'invalid_image')
  assert.equal(fields.upstreamErrorCode, 'decode_error')
  assert.equal(fields.retryAfter, '30')
  assert.equal(fields.cfRay, 'ray')
  const serialized = JSON.stringify(scope.safeFields(fields))
  assert.ok(!serialized.includes(input.key))
  assert.ok(!serialized.includes(jpeg.toString('base64')))
  assert.ok(serialized.includes('[redacted image]'))
})

test('a non-JSON gateway failure keeps its HTTP status without logging the response body', async () => {
  const f = fixture(new Response('<html>gateway response</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
  await assert.rejects(requestOpenRouterDecision({ ...input, fetcher: f.fetcher }), /HTTP 502/)
  assert.equal(f.scope().fields.responseIsJson, false)
  assert.equal(f.scope().fields.responseContentType, 'text/html')
  assert.ok(!JSON.stringify(f.scope().fields).includes('gateway response'))
})

for (const status of [502, 200]) test(`an explicit question refusal is a distinct error even with HTTP ${status}`, async () => {
  const f = fixture(Response.json({ error: { code: 502, message: 'OpenAI refused to answer question "account_type"' } }, { status }))
  await assert.rejects(requestOpenRouterDecision({ ...input, fetcher: f.fetcher }), DecisionRefusedError)
  assert.equal(f.scope().fields.failureKind, 'refused')
  assert.equal(f.scope().fields.httpStatus, status)
})

test('successful HTTP responses with invalid JSON are identified separately', async () => {
  const f = fixture(new Response('not json'))
  await assert.rejects(requestOpenRouterDecision({ ...input, fetcher: f.fetcher }), /invalid JSON/)
  assert.equal(f.scope().fields.httpStatus, 200)
  assert.equal(f.scope().fields.failureKind, 'response')
})

test('provider errors inside HTTP 200 are rejected after a bounded retry', async () => {
  const f = fixture(Response.json({ error: { code: 502, message: 'Provider unavailable' } }))
  await assert.rejects(requestOpenRouterDecision({ ...input, fetcher: f.fetcher }), /provider error/)
  assert.equal(f.scope().fields.outcome, 'error')
  assert.equal(f.scope().fields.failureKind, 'provider')
  assert.equal(f.scope().fields.attemptCount, 2)
})

test('network failures retain the transport code without inventing an HTTP status', async () => {
  let scope: LogScope | undefined
  const fetcher = (async () => { scope = currentLogScope(); throw new Error('Fetch failed', { cause: { code: 'ECONNRESET' } }) }) as typeof fetch
  await assert.rejects(requestOpenRouterDecision({ ...input, fetcher }), /Fetch failed/)
  assert.ok(scope?.completed)
  assert.equal(scope.fields.networkCode, 'ECONNRESET')
  assert.equal(scope.fields.failureKind, 'network')
  assert.equal(scope.fields.httpStatus, undefined)
})

test('the existing request deadline is retained and distinguishes an abort from a gateway failure', async () => {
  let scope: LogScope | undefined
  const fetcher = (async (_url: unknown, options: RequestInit) => {
    scope = currentLogScope()
    return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }))
  }) as typeof fetch
  await assert.rejects(requestOpenRouterDecision({ ...input, timeout: 5, fetcher }), { name: 'TimeoutError' })
  assert.ok(scope?.completed)
  assert.equal(scope.fields.timeoutMs, 5)
  assert.equal(scope.fields.failureKind, 'timeout')
})

for (const failure of ['network', 'body-network', 'timeout', 'gateway', 'rate-limit', 'provider'] as const)
  test(`one retry recovers a transient ${failure} failure with the same payload and model`, async () => {
    let calls = 0, scope: LogScope | undefined
    const signals: AbortSignal[] = []
    const bodies: unknown[] = []
    const fetcher = (async (_url: unknown, options: RequestInit) => {
      calls++; scope = currentLogScope(); signals.push(options.signal!); bodies.push(options.body)
      if (calls === 1) {
        if (failure === 'network') throw new Error('Fetch failed')
        if (failure === 'body-network') return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"answers":'))
            controller.error(new Error('Connection reset', { cause: { code: 'ECONNRESET' } }))
          },
        }), { status: 200 })
        if (failure === 'timeout') return new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
        })
        if (failure === 'provider') return Response.json({ error: { code: 502, message: 'Provider unavailable' } })
        return Response.json({ error: { message: 'Temporary failure' } }, {
          status: failure === 'rate-limit' ? 429 : 502,
          headers: failure === 'rate-limit' ? { 'retry-after': '0' } : {},
        })
      }
      return Response.json({ answers: { matches_topic: { type: 'noul', noul: 0.9 } } })
    }) as typeof fetch
    const result = await requestOpenRouterDecision({ ...input, fetcher })
    assert.deepEqual(result, { answers: { matches_topic: { type: 'noul', noul: 0.9 } } })
    assert.equal(calls, 2)
    assert.equal(bodies[0], bodies[1])
    assert.equal(JSON.parse(String(bodies[1])).image, input.payload.image)
    assert.notEqual(signals[0], signals[1])
    assert.equal(scope?.fields.httpStatus, 200)
    assert.equal(scope?.fields.failureKind, undefined, 'a recovered request must not retain its old error')
    assert.equal(scope?.fields.providerErrorMessage, undefined)
    assert.equal(scope?.fields.attemptCount, 2)
    assert.equal(scope?.fields.retryCount, 1)
    assert.equal(scope?.fields.model, input.model)
    assert.ok(scope)
    assert.equal((scope.fields.retryFailures as unknown[]).length, 1)
    if (failure === 'body-network') assert.deepEqual(scope.fields.retryFailures,
      [{ attempt: 1, failureKind: 'network', httpStatus: 200 }])
  })

for (const response of [
  Response.json({ error: { message: 'Invalid request' } }, { status: 400 }),
  Response.json({ error: { message: 'Unauthorized' } }, { status: 401 }),
  Response.json({ error: { message: 'Refused to answer question "account_type"' } }, { status: 502 }),
  Response.json({ error: { message: 'Rate limited' } }, { status: 429, headers: { 'retry-after': '60' } }),
  Response.json({ error: { message: 'Rate limited' } }, { status: 429, headers: { 'retry-after': new Date(Date.now() + 60_000).toUTCString() } }),
  new Response('invalid JSON'),
]) test(`permanent errors and retry delays beyond the deadline are not retried (${response.status})`, async () => {
  let calls = 0
  await assert.rejects(requestOpenRouterDecision({ ...input, fetcher: (async () => { calls++; return response.clone() }) as typeof fetch }))
  assert.equal(calls, 1)
})

test('repeated timeouts share the original total deadline and stop after two attempts', async () => {
  let calls = 0
  const started = performance.now()
  await assert.rejects(requestOpenRouterDecision({ ...input, timeout: 1000,
    fetcher: (async (_url: unknown, options: RequestInit) => {
      calls++
      return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }))
    }) as typeof fetch,
  }))
  assert.equal(calls, 2)
  assert.ok(performance.now() - started < 1500, 'retry must not receive a fresh full request budget')
})
