import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { BrowserContext } from 'playwright-core'
import { installSessionCursor, renderSessionCursor } from './sessionCursor.js'

async function withDocument(run: (window: Window) => void) {
  const window = new Window()
  const previous = new Map(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true })
  try { run(window) }
  finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    await window.happyDOM.close()
  }
}

test('stream cursor follows pointer movement and click coordinates without consuming input', async () => {
  await withDocument(window => {
    window.document.body.innerHTML = '<button>Real target</button>'
    renderSessionCursor()
    const cursor = window.document.getElementById('igbot-session-cursor')!
    assert.equal(cursor.style.display, 'none')
    assert.equal(cursor.style.pointerEvents, 'none')
    assert.equal(cursor.style.getPropertyPriority('pointer-events'), 'important')
    assert.equal(cursor.getAttribute('aria-hidden'), 'true')
    assert.equal(cursor.shadowRoot, null, 'cursor styling stays in a closed shadow root')
    const button = window.document.querySelector('button')!
    let moves = 0, clicks = 0
    button.addEventListener('mousemove', () => { moves++ })
    button.addEventListener('mousedown', () => { clicks++ })
    for (const [x, y] of [[40, 50], [80, 90], [200, 300]]) {
      button.dispatchEvent(new window.MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }))
      assert.equal(cursor.style.transform, `translate(${x - 1}px, ${y - 1}px)`)
    }
    button.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 220, clientY: 320, bubbles: true }))
    assert.equal(cursor.style.transform, 'translate(219px, 319px)')
    assert.equal(cursor.style.display, 'block')
    assert.equal(moves, 3)
    assert.equal(clicks, 1)
    button.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }))
    assert.equal(cursor.style.display, 'none')
    button.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }))
    window.dispatchEvent(new window.Event('blur'))
    assert.equal(cursor.style.display, 'none')
  })
})

test('reinstalling the cursor does not duplicate its indicator', async () => {
  await withDocument(window => {
    renderSessionCursor()
    renderSessionCursor()
    assert.equal(window.document.querySelectorAll('#igbot-session-cursor').length, 1)
  })
})

test('early navigation initialization waits for the document root and installs once', async () => {
  await withDocument(window => {
    window.document.documentElement.remove()
    renderSessionCursor()
    renderSessionCursor()
    window.document.appendChild(window.document.createElement('html'))
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
    assert.equal(window.document.querySelectorAll('#igbot-session-cursor').length, 1)
  })
})

test('cursor initialization works for future navigations and restored pages', async () => {
  const calls: string[] = []
  const context = {
    addInitScript: async (fn: unknown) => { assert.equal(fn, renderSessionCursor); calls.push('init-script') },
    pages: () => [
      { evaluate: async (fn: unknown) => { assert.equal(fn, renderSessionCursor); calls.push('restored-page') } },
      { evaluate: async () => { throw new Error('Page navigated') } },
    ],
  } as unknown as BrowserContext
  await installSessionCursor(context)
  assert.deepEqual(calls, ['init-script', 'restored-page'])
})
