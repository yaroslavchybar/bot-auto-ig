import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProfileCookiesJson } from './cookies.js'

test('profile edits accept browser cookies with empty values', () => {
  const cookies = [{ name: 'empty', value: '', domain: '.instagram.com', path: '/' }]
  assert.deepEqual(JSON.parse(normalizeProfileCookiesJson(JSON.stringify(cookies))!), cookies)
})

test('an empty browser cookie jar remains editable', () => {
  assert.equal(normalizeProfileCookiesJson('[]'), '[]')
})
