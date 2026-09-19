import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCookieUpdate, normalizeCookiesJsonForForm } from './cookieJson'

const cookies = [{ name: 'sessionid', value: 'old', domain: '.instagram.com', path: '/' }]

test('unchanged cookies are omitted even when the form reformats them', () => {
  assert.equal(getCookieUpdate(JSON.stringify(cookies, null, 2), JSON.stringify(cookies)), undefined)
  assert.equal(getCookieUpdate(undefined, undefined), undefined)
})

test('explicit cookie replacement and clearing are sent', () => {
  const replacement = JSON.stringify([{ ...cookies[0], value: 'new' }])
  assert.equal(getCookieUpdate(replacement, JSON.stringify(cookies)), replacement)
  assert.equal(getCookieUpdate(undefined, JSON.stringify(cookies)), '')
})

test('an empty jar saved by the browser can be edited without changing cookies', () => {
  assert.deepEqual(normalizeCookiesJsonForForm('[]'), { normalized: '' })
  assert.equal(getCookieUpdate(undefined, '[]'), undefined)
})
