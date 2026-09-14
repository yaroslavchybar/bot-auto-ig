import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCookiesJsonForForm } from './cookieJson'

function mustNormalize(raw: string): unknown[] {
  const result = normalizeCookiesJsonForForm(raw)
  assert.equal(result.error, undefined)
  assert.ok(result.normalized)
  return JSON.parse(result.normalized) as unknown[]
}

test('accepts Playwright cookie arrays', () => {
  const cookies = mustNormalize(
    JSON.stringify([
      { name: 'sessionid', value: 'abc', domain: '.instagram.com', path: '/' },
    ]),
  )
  assert.equal(cookies.length, 1)
})

test('accepts AdsPower-style objects with a cookies array', () => {
  const cookies = mustNormalize(
    JSON.stringify({
      cookies: [
        { name: 'sessionid', value: 'abc', domain: '.instagram.com' },
      ],
    }),
  )
  assert.equal(cookies.length, 1)
})

test('accepts a single cookie object', () => {
  const cookies = mustNormalize(
    JSON.stringify({ name: 'sessionid', value: 'abc', domain: '.instagram.com' }),
  )
  assert.equal(cookies.length, 1)
})

test('accepts Netscape cookies.txt', () => {
  const cookies = mustNormalize(
    [
      '# Netscape HTTP Cookie File',
      '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1792312313\tsessionid\tabc123',
      '.instagram.com\tTRUE\t/\tFALSE\t1792312313\tcsrftoken\tdef456',
    ].join('\n'),
  ) as Array<{ name: string; value: string; domain: string; httpOnly?: boolean; secure?: boolean }>
  assert.equal(cookies.length, 2)
  assert.equal(cookies[0]?.name, 'sessionid')
  assert.equal(cookies[0]?.domain, '.instagram.com')
  assert.equal(cookies[0]?.httpOnly, true)
  assert.equal(cookies[0]?.secure, true)
  assert.equal(cookies[1]?.name, 'csrftoken')
})

test('accepts document.cookie style pairs', () => {
  const cookies = mustNormalize(
    'sessionid=abc123; csrftoken=def456',
  ) as Array<{ name: string; value: string; domain: string }>
  assert.equal(cookies.length, 2)
  assert.equal(cookies[0]?.name, 'sessionid')
  assert.equal(cookies[0]?.value, 'abc123')
  assert.equal(cookies[0]?.domain, '.instagram.com')
})

test('defaults missing domains to .instagram.com', () => {
  const cookies = mustNormalize(
    JSON.stringify([{ name: 'sessionid', value: 'abc' }]),
  ) as Array<{ domain: string }>
  assert.equal(cookies[0]?.domain, '.instagram.com')
})

test('allows empty cookie values instead of blocking the save', () => {
  const cookies = mustNormalize(
    JSON.stringify([
      { name: 'sessionid', value: 'abc', domain: '.instagram.com' },
      { name: 'msp', value: '', domain: '.instagram.com' },
    ]),
  )
  assert.equal(cookies.length, 2)
})

test('normalized output round-trips through the form', () => {
  const first = normalizeCookiesJsonForForm(
    JSON.stringify([{ name: 'sessionid', value: 'abc' }]),
  )
  assert.equal(first.error, undefined)
  const second = normalizeCookiesJsonForForm(first.normalized ?? '')
  assert.equal(second.error, undefined)
  assert.equal(second.normalized, first.normalized)
})

test('preserves percent-encoded cookie values byte-for-byte', () => {
  const cookies = mustNormalize(
    'sessionid=abc%3Adef%2Fghi; csrftoken=x%3Dy',
  ) as Array<{ name: string; value: string }>
  assert.equal(cookies[0]?.value, 'abc%3Adef%2Fghi')
  assert.equal(cookies[1]?.value, 'x%3Dy')
})

test('empty input clears without error', () => {
  assert.deepEqual(normalizeCookiesJsonForForm('   '), { normalized: '' })
})

test('rejects garbage with actionable help', () => {
  const result = normalizeCookiesJsonForForm('not cookies at all???')
  assert.ok(result.error)
  assert.equal(result.normalized, undefined)
})
