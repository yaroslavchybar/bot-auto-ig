import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachClipboardBridge } from './clipboardBridge'

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function setup() {
  const state = { active: true, focused: true, local: 'Привіт 👋\nhello' }
  const keys: Array<[number, string, boolean | undefined]> = []
  const writes: string[] = []
  const errors: string[] = []
  const screen = Object.assign(new EventTarget(), {
    ownerDocument: Object.assign(new EventTarget(), { hasFocus: () => state.focused, activeElement: {}, visibilityState: 'visible' }),
    contains: () => state.focused,
  })
  const rfb = Object.assign(new EventTarget(), {
    sendKey: (key: number, code: string, down?: boolean) => { keys.push([key, code, down]) },
  })
  const clipboard = {
    readText: async () => state.local,
    writeText: async (text: string) => { state.local = text },
  }
  let acknowledge: () => void = () => {}
  const bridge = attachClipboardBridge({
    screen: screen as unknown as HTMLElement,
    rfb,
    canInteract: () => state.active,
    clipboard,
    writeRemoteText: (text) => {
      writes.push(text)
      return new Promise<void>((resolve) => { acknowledge = resolve })
    },
    onError: (message) => { errors.push(message) },
  })
  function key(overrides: Record<string, unknown> = {}) {
    const event = Object.assign(new Event('keydown', { cancelable: true }), {
      code: 'KeyV', key: 'v', ctrlKey: true, metaKey: false,
      altKey: false, shiftKey: false, repeat: false, ...overrides,
    })
    screen.dispatchEvent(event)
    return event
  }
  const remoteCopy = (text: string) => rfb.dispatchEvent(new CustomEvent('clipboard', { detail: { text } }))
  return { state, keys, writes, errors, clipboard, screen, key, remoteCopy, cleanup: bridge.dispose, cancel: bridge.cancel, acknowledge: () => acknowledge() }
}

test('paste sends Unicode text, waits for clipboard readiness, and then presses Ctrl+V', async () => {
  const h = setup()
  try {
    assert.equal(h.key().defaultPrevented, true)
    await flush()
    assert.deepEqual(h.writes, ['Привіт 👋\nhello'])
    assert.deepEqual(h.keys, [])
    h.acknowledge()
    await flush()
    assert.deepEqual(h.keys.slice(-4), [
      [0xffe3, 'ControlLeft', true], [0x76, 'KeyV', undefined], [0xffe3, 'ControlLeft', false],
      [0xffe3, 'ControlLeft', true],
    ])
  } finally { h.cleanup() }
})

test('Cmd+Shift+V uses the remote plain-text paste shortcut and ignores repeat presses', async () => {
  const h = setup()
  try {
    h.key({ ctrlKey: false, metaKey: true, shiftKey: true })
    h.key({ ctrlKey: false, metaKey: true, shiftKey: true, repeat: true })
    await flush()
    assert.equal(h.writes.length, 1)
    h.acknowledge()
    await flush()
    assert.deepEqual(h.keys.slice(-7, -2), [
      [0xffe3, 'ControlLeft', true], [0xffe1, 'ShiftLeft', true],
      [0x76, 'KeyV', undefined], [0xffe1, 'ShiftLeft', false], [0xffe3, 'ControlLeft', false],
    ])
  } finally { h.cleanup() }
})

test('permission denial does not paste the stale remote clipboard', async () => {
  const h = setup()
  h.clipboard.readText = async () => { throw new Error('Permission denied') }
  try {
    h.key()
    await flush()
    assert.deepEqual(h.writes, [])
    assert.deepEqual(h.keys, [])
    assert.equal(h.errors.length, 1)
  } finally { h.cleanup() }
})

test('losing control, focus, or the connection cancels a pending paste', async () => {
  for (const cancel of ['control', 'focus', 'dispose']) {
    const h = setup()
    try {
      h.key()
      await flush()
      if (cancel === 'control') h.state.active = false
      if (cancel === 'focus') h.state.focused = false
      if (cancel === 'dispose') h.cleanup()
      h.acknowledge()
      await flush()
      assert.deepEqual(h.keys, [], cancel)
    } finally { h.cleanup() }
  }
})

test('remote copies sync only from the focused interactive viewer', async () => {
  const h = setup()
  try {
    h.remoteCopy('remote text')
    await flush()
    assert.equal(h.state.local, 'remote text')
    h.state.focused = false
    h.remoteCopy('background text')
    assert.equal(h.key().defaultPrevented, false)
    h.state.focused = true
    h.state.active = false
    h.remoteCopy('agent text')
    assert.equal(h.key().defaultPrevented, false)
    h.state.active = true
    h.cleanup()
    h.remoteCopy('disconnected text')
    assert.equal(h.state.local, 'remote text')
    assert.deepEqual(h.writes, [])
  } finally { h.cleanup() }
})

test('paste does not re-press Ctrl if it was released while waiting', async () => {
  const h = setup()
  try {
    h.key()
    await flush()
    h.screen.dispatchEvent(Object.assign(new Event('keyup'), {
      code: 'ControlLeft', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    }))
    h.acknowledge()
    await flush()
    assert.deepEqual(h.keys.at(-1), [0xffe3, 'ControlLeft', false])
  } finally { h.cleanup() }
})

test('pointer, keyboard, focus, and control changes permanently cancel delayed paste', async () => {
  for (const action of ['pointerdown', 'wheel', 'focusout', 'keydown', 'control']) {
    const h = setup()
    try {
      h.key()
      await flush()
      if (action === 'control') h.cancel()
      else if (action === 'keydown') h.key({ code: 'Tab', key: 'Tab', ctrlKey: false })
      else h.screen.dispatchEvent(new Event(action))
      // Focus/control can be regained before the old response arrives.
      h.state.focused = true
      h.state.active = true
      h.acknowledge()
      await flush()
      assert.deepEqual(h.keys, [], action)
    } finally { h.cleanup() }
  }
})

test('duplicate remote copy notifications create only one local clipboard write', async () => {
  const h = setup()
  const copied: string[] = []
  h.clipboard.writeText = async (text) => { copied.push(text) }
  try {
    h.remoteCopy('complete text')
    h.remoteCopy('complete text')
    await flush()
    assert.deepEqual(copied, ['complete text'])
    h.screen.dispatchEvent(new Event('focusout'))
    h.remoteCopy('complete text')
    await flush()
    assert.equal(copied.length, 2)
  } finally { h.cleanup() }
})

test('blocked automatic copy points to the manual panel', async () => {
  const h = setup()
  h.clipboard.writeText = async () => { throw new Error('Permission denied') }
  try {
    h.remoteCopy('remote text')
    await flush()
    assert.match(h.errors[0], /Copy to my PC/)
  } finally { h.cleanup() }
})

test('native paste events use their text without requesting clipboard permission', async () => {
  const h = setup()
  h.clipboard.readText = async () => { throw new Error('Must not request permission') }
  try {
    h.screen.dispatchEvent(Object.assign(new Event('paste', { cancelable: true }), {
      clipboardData: { getData: () => 'native paste' },
    }))
    await flush()
    assert.deepEqual(h.writes, ['native paste'])
    h.acknowledge()
    await flush()
    assert.deepEqual(h.errors, [])
  } finally { h.cleanup() }
})
