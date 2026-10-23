import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseModelUsernames,
  parseModelFullNames,
  isValidModelUsername,
  isValidModelFullName,
  normalizeModelUsername,
} from './modelIdentity.js'

test('model username input preserves order while normalizing separators, case and duplicates', () => {
  assert.deepEqual(parseModelUsernames(' @Alice,BOB\n alice  @bob\tcharlie_1 '), {
    items: ['alice', 'bob', 'charlie_1'],
    duplicates: 2,
  })
  assert.equal(normalizeModelUsername(' @ALICE '), 'alice')
  for (const name of ['alice', 'a.b_1', 'a'.repeat(30)])
    assert.equal(isValidModelUsername(name), true)
  for (const name of ['', 'a'.repeat(31), 'with-dash', '@alice', 'two names', 'ALICE'])
    assert.equal(isValidModelUsername(name), false)
})

test('full names retain Unicode, punctuation and spaces instead of using username tokenization', () => {
  assert.deepEqual(parseModelFullNames("  Анна Коваль  \r\nAnna O'Neil\n\nАнна Коваль"), {
    items: ['Анна Коваль', "Anna O'Neil"],
    duplicates: 1,
  })
  for (const name of ['Анна Коваль', 'Anna 🌻', "Anna O'Neil", 'Anna123'])
    assert.equal(isValidModelFullName(name), true)
  for (const name of ['ab', 'a'.repeat(81), 'Anna/Name'])
    assert.equal(isValidModelFullName(name), false)
})
