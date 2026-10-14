import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentLogScope, logOperation, type LogScope } from '../../shared/logger.js'
import { requestOpenRouterDecision } from './openrouter-decision.js'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x02, 0xa3, 0x04, 0xb0,
  3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9])
const input = { kind: 'topic' as const, model: 'fixture-model', screenshot: jpeg, timeout: 1000,
  key: 'fixture-openrouter-secret', errorPrefix: 'Topic provider',
  payload: { questions: { matches_topic: {} }, image: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }

function fixture(response: Response) {
  let scope: LogScope | undefined
  const fetcher = (async () => { scope = currentLogScope(); return response }) as typeof fetch
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

test('successful HTTP responses with invalid JSON are identified separately', async () => {
  const f = fixture(new Response('not json'))
  await assert.rejects(requestOpenRouterDecision({ ...input, fetcher: f.fetcher }), /invalid JSON/)
  assert.equal(f.scope().fields.httpStatus, 200)
  assert.equal(f.scope().fields.failureKind, 'response')
})

test('provider errors inside HTTP 200 are logged as errors for downstream validation', async () => {
  const f = fixture(Response.json({ error: { code: 502, message: 'Provider unavailable' } }))
  const data = await requestOpenRouterDecision({ ...input, fetcher: f.fetcher })
  assert.deepEqual(data, { error: { code: 502, message: 'Provider unavailable' } })
  assert.equal(f.scope().fields.outcome, 'error')
  assert.equal(f.scope().fields.failureKind, 'provider')
  assert.deepEqual(f.scope().fields.answerTypes, { matches_topic: 'missing' })
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
