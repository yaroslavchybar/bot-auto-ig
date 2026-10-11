import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderOutreachMessage, validateOutreachMessage } from './outreachMessage.js'

const recipient = { username: 'alice', fullName: 'Alice Smith' }

test('plain messages and existing username placeholders still work', () => {
  assert.equal(renderOutreachMessage('Hi {{username}}!', recipient), 'Hi alice!')
  assert.equal(renderOutreachMessage('Hello {name} / {{name}}', recipient), 'Hello Alice / Alice')
  assert.equal(renderOutreachMessage('Hello {name}', { username: 'alice' }), 'Hello alice')
})

test('square-bracket placeholders work with curly-brace variations', () => {
  assert.equal(
    renderOutreachMessage('{hi|hey} [name], @[username]!', recipient, () => 0.999),
    'hey Alice, @alice!',
  )
  assert.equal(renderOutreachMessage('[name] / [username]', { username: 'alice' }), 'alice / alice')
})

test('each group makes an independent choice while preserving spaces and line breaks', () => {
  const values = [0, 0.999, 0.5]
  const random = () => values.shift()!
  assert.equal(
    renderOutreachMessage(
      '{hey|hi|yo} [name]\n{helping|help} {web3 teams|crypto projects|companies}',
      recipient,
      random,
    ),
    'hey Alice\nhelp crypto projects',
  )
  assert.equal(values.length, 0)
})

test('nested choices, optional text, and ordinary braces are supported', () => {
  assert.equal(
    renderOutreachMessage('{Hello|{Hi|Hey}} [username]{!|}', recipient, () => 0.999),
    'Hey alice',
  )
  assert.equal(renderOutreachMessage('Text {literal} a|b', recipient), 'Text {literal} a|b')
  assert.equal(
    renderOutreachMessage('{{Hi|Hey}|Hello} {{username}}', recipient, () => 0),
    'Hi alice',
  )
})

test('recipient data is inserted after variations and is never parsed as syntax', () => {
  assert.equal(
    renderOutreachMessage('{Hi|Hey} [name]', { username: 'alice', fullName: '{One|Two}' }, () => 0),
    'Hi {One|Two}',
  )
})

test('broken syntax is rejected before saving or sending', () => {
  for (const message of ['{Hi|Hey', 'Hi}', '{{username}']) {
    assert.throws(() => validateOutreachMessage(message), /brace|variation|placeholder/)
    assert.throws(() => renderOutreachMessage(message, recipient), /brace|variation|placeholder/)
  }
  assert.throws(() => renderOutreachMessage('{|}', recipient), /empty/)
  assert.throws(() => validateOutreachMessage('{ |Hi}'), /empty/)
  assert.doesNotThrow(() => validateOutreachMessage('Hi{!|}'))
  assert.throws(() => renderOutreachMessage('a'.repeat(1001), recipient), /1,000/)
  assert.throws(
    () => renderOutreachMessage('a'.repeat(990) + '[name]', { username: 'a'.repeat(20) }),
    /1,000/,
  )
})
