import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderOutreachMessages, validateOutreachMessage } from './outreachMessage.js'

const recipient = { username: 'alice', fullName: 'Alice Smith' }

test('plain messages and existing username placeholders still work', () => {
  assert.deepEqual(renderOutreachMessages('Hi {{username}}!', recipient), ['Hi alice!'])
  assert.deepEqual(renderOutreachMessages('Hello {name} / {{name}}', recipient), ['Hello Alice / Alice'])
  assert.deepEqual(renderOutreachMessages('Hello {name}', { username: 'alice' }), ['Hello alice'])
})

test('square-bracket placeholders work with curly-brace variations', () => {
  assert.deepEqual(
    renderOutreachMessages('{hi|hey} [name], @[username]!', recipient, () => 0.999),
    ['hey Alice, @alice!'],
  )
  assert.deepEqual(renderOutreachMessages('[name] / [username]', { username: 'alice' }), ['alice / alice'])
})

test('each group makes an independent choice while preserving spaces and line breaks', () => {
  const values = [0, 0.999, 0.5]
  const random = () => values.shift()!
  assert.deepEqual(
    renderOutreachMessages(
      '{hey|hi|yo} [name]\n{helping|help} {web3 teams|crypto projects|companies}',
      recipient,
      random,
    ),
    ['hey Alice\nhelp crypto projects'],
  )
  assert.equal(values.length, 0)
})

test('nested choices, optional text, and ordinary braces are supported', () => {
  assert.deepEqual(
    renderOutreachMessages('{Hello|{Hi|Hey}} [username]{!|}', recipient, () => 0.999),
    ['Hey alice'],
  )
  assert.deepEqual(renderOutreachMessages('Text {literal} a|b', recipient), ['Text {literal} a|b'])
  assert.deepEqual(
    renderOutreachMessages('{{Hi|Hey}|Hello} {{username}}', recipient, () => 0),
    ['Hi alice'],
  )
})

test('recipient data is inserted after variations and is never parsed as syntax', () => {
  assert.deepEqual(
    renderOutreachMessages('{Hi|Hey} [name]', { username: 'alice', fullName: '{One|Two}\\Three' }, () => 0),
    ['Hi {One|Two}\\Three'],
  )
})

test('broken syntax is rejected before saving or sending', () => {
  for (const message of ['{Hi|Hey', 'Hi}', '{{username}']) {
    assert.throws(() => validateOutreachMessage(message), /brace|variation|placeholder/)
    assert.throws(() => renderOutreachMessages(message, recipient), /brace|variation|placeholder/)
  }
  assert.throws(() => renderOutreachMessages('{|}', recipient), /empty/)
  assert.throws(() => validateOutreachMessage('{ |Hi}'), /empty/)
  assert.doesNotThrow(() => validateOutreachMessage('Hi{!|}'))
  assert.throws(() => renderOutreachMessages('a'.repeat(1001), recipient), /1,000/)
  assert.throws(
    () => renderOutreachMessages('a'.repeat(990) + '[name]', { username: 'a'.repeat(20) }),
    /1,000/,
  )
})

test('backslashes split ordered messages while each variation is resolved once', () => {
  const choices = [0, 0.999]
  assert.deepEqual(renderOutreachMessages('{Hi|Hey} [name] \\ {How are you?|How is it going?}', recipient, () => choices.shift()!),
    ['Hi Alice', 'How is it going?'])
  assert.equal(choices.length, 0)
  assert.deepEqual(renderOutreachMessages('hello\\how are you?', recipient), ['hello', 'how are you?'])
  assert.deepEqual(renderOutreachMessages('{hi\\how are you?|hey}', recipient, () => 0), ['hi', 'how are you?'])
  assert.deepEqual(renderOutreachMessages('{hi\\how are you?|hey}', recipient, () => 0.999), ['hey'])
})

test('forward slashes stay literal and links stay intact in separate messages', () => {
  assert.deepEqual(renderOutreachMessages('1/2 / hello // https://example.com/a/b', recipient),
    ['1/2 / hello // https://example.com/a/b'])
  assert.deepEqual(renderOutreachMessages('1/2 \\ https://example.com/a/b \\ www.example.com/x/y', recipient),
    ['1/2', 'https://example.com/a/b', 'www.example.com/x/y'])
  assert.deepEqual(renderOutreachMessages('https://instagram.com/{{username}}/ \\ hello', recipient),
    ['https://instagram.com/alice/', 'hello'])
})

test('a backslash before a newline sends the caption and Instagram link as two intact messages', () => {
  const caption = 'Just posted a new pic on this account, curious what you think'
  assert.deepEqual(renderOutreachMessages(caption + ' \\\nhttps://www.instagram.com/nastya_rainy/', recipient),
    [caption, 'https://www.instagram.com/nastya_rainy/'])
})

test('saving rejects empty messages in any variation without enumerating combinations', () => {
  for (const message of ['\\Hi', 'Hi\\', 'Hi\\\\Hey', '{Hi\\|Hey}', 'Hi \\ {Hey| }'])
    assert.throws(() => validateOutreachMessage(message), /empty/)
  assert.doesNotThrow(() => validateOutreachMessage('Hi{ \\ Hey|}'))
  assert.doesNotThrow(() => validateOutreachMessage(''))
})
