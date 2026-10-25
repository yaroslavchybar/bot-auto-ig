import WebSocket from 'ws'
import { patchPage, resolveConfig } from 'cloakbrowser/human'
import type { BrowserContext, CDPSession, Page } from 'playwright-core'
import { runtimeHeaders, runtimeUrl } from '../shared/runtime.js'
import type { Display } from './display.js'

export type NativeWheel = (x: number, y: number, direction: 'up' | 'down', timeout: number) => Promise<void>
export type NativeBack = (timeout: number) => Promise<void>
type PointerAction = { wheel: 'up' | 'down' } | { back: true }
const nativeWheels = new WeakMap<Page, NativeWheel>()
const nativeBacks = new WeakMap<Page, NativeBack>()
const desktopCursors = new WeakMap<Page, Readonly<{ x: number; y: number }>>()

/** Headed automation pages can send discrete notches through their leased X11 display. */
export function nativeWheelFor(page: Page): NativeWheel | undefined { return nativeWheels.get(page) }
export function nativeBackFor(page: Page): NativeBack | undefined { return nativeBacks.get(page) }
export function desktopCursorFor(page: Page): Readonly<{ x: number; y: number }> | undefined { return desktopCursors.get(page) }

/** X11 uses the real side button; local/headless Chromium receives the same Back button through CDP. */
export function mouseBackFor(page: Page): NativeBack {
  return nativeBackFor(page) ?? (async timeout => {
    const deadline = Date.now() + timeout
    let pending: Promise<CDPSession> | undefined, cdp: CDPSession
    try {
      cdp = await beforeInputDeadline(() => pending = page.context().newCDPSession(page), deadline)
    } catch (error) {
      void pending?.then(session => session.detach()).catch(() => {})
      throw error
    }
    const viewport = page.viewportSize() ?? { width: 800, height: 600 }
    const { x, y } = desktopCursorFor(page) ?? { x: viewport.width / 2, y: viewport.height / 2 }
    let pressed = false
    try {
      await beforeInputDeadline(() => {
        if (Date.now() >= deadline) throw new Error('Native input deadline ended')
        pressed = true
        return cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'back', buttons: 8, clickCount: 1 })
      }, deadline)
    } finally {
      try {
        // Queue release even after an uncertain press; never leave a held side button.
        if (pressed) await beforeInputDeadline(() => cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x, y, button: 'back', buttons: 0, clickCount: 1,
        }), Date.now() + 5000)
      } finally { void cdp.detach().catch(() => {}) }
    }
  })
}

// Race each CDP wait against the same deadline; late results cannot resume input.
function beforeInputDeadline<T>(start: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return Promise.reject(new Error('Native input deadline ended'))
  if (!Number.isFinite(remaining)) return start()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native input deadline ended')), remaining)
    Promise.resolve().then(start).then(value => {
      clearTimeout(timer)
      resolve(value)
    }, error => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/** Sync X11 before the unified Cloak engine emits each raw pointer move. */
export async function installDesktopPointer(
  context: BrowserContext,
  display: Pick<Display, 'vncPort' | 'id'>,
): Promise<() => void> {
  const socket = new WebSocket(
    `${runtimeUrl().replace(/^http/, 'ws')}/displays/${display.vncPort}/pointer`,
    {
      headers: { ...runtimeHeaders(), 'X-Display-Id': display.id },
      maxPayload: 4096,
    },
  )
  const request = (input?: object): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        finish(new Error('Desktop pointer timed out'))
        socket.terminate()
      }, 5000)
      const finish = (error?: Error) => {
        clearTimeout(timer)
        socket.off('message', message)
        socket.off('error', failed)
        socket.off('close', closed)
        if (error) reject(error)
        else resolve()
      }
      const message = (data: WebSocket.RawData) => {
        try {
          const reply = JSON.parse(data.toString()) as { ready?: boolean; error?: string }
          finish(reply.ready ? undefined : new Error(reply.error || 'Desktop pointer unavailable'))
        } catch {
          finish(new Error('Invalid desktop pointer response'))
        }
      }
      const failed = () => finish(new Error('Desktop pointer connection failed'))
      const closed = () => finish(new Error('Desktop pointer disconnected'))
      socket.once('message', message)
      socket.once('error', failed)
      socket.once('close', closed)
      if (input) {
        if (socket.readyState !== WebSocket.OPEN) closed()
        else
          socket.send(JSON.stringify(input), (error) => {
            if (error) finish(error)
          })
      }
    })
  // Keep idle transport errors handled too; the next move fails instead of crashing the worker.
  socket.on('error', () => {})
  try {
    await request()
  } catch (error) {
    socket.terminate()
    throw error
  }
  let queue = Promise.resolve()
  let closed = false
  const pages = new Set<Page>()
  const detachMetrics: (() => void)[] = []
  const enqueue = (action: () => Promise<void>) => {
    const work = queue.then(action)
    queue = work.catch(() => {})
    return work
  }
  const attach = (page: Page) => {
    if (pages.has(page)) return
    pages.add(page)
    const human = patchPage(page, resolveConfig('careful'))
    const move = human.raw.move.bind(human.raw)
    let geometry: { width: number; height: number; expiresAt: number } | undefined
    let revision = 0
    const invalidate = () => { geometry = undefined; revision++ }
    const attached = context.newCDPSession(page)
    const metrics = attached.then(async session => {
      if (closed) throw new Error('Desktop pointer disconnected')
      session.on('Page.frameResized', invalidate)
      session.on('Page.frameNavigated', invalidate)
      await session.send('Page.enable')
      return session
    })
    detachMetrics.push(() => {
      invalidate()
      void attached.then(async session => {
        session.off('Page.frameResized', invalidate)
        session.off('Page.frameNavigated', invalidate)
        await session.detach()
      }).catch(() => {})
    })
    const input = async (x: number, y: number, action?: PointerAction, deadline = Infinity) => {
      if (closed) throw new Error('Desktop pointer disconnected')
      const session = await beforeInputDeadline(() => metrics, deadline)
      // Reuse geometry only during a short burst of raw moves. Discrete input reads it fresh.
      while (action || !geometry || geometry.expiresAt <= Date.now()) {
        const readingRevision = revision
        const { cssLayoutViewport } = await beforeInputDeadline(() => session.send('Page.getLayoutMetrics'), deadline)
        if (closed) throw new Error('Desktop pointer disconnected')
        if (readingRevision !== revision) continue
        geometry = { width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight,
          expiresAt: Date.now() + 100 }
        break
      }
      if (Date.now() >= deadline) throw new Error('Native input deadline ended')
      // Once sent, keep the queue until the transport result; expiry cannot undo input.
      await request({ x, y, width: geometry.width, height: geometry.height,
        ...action })
      desktopCursors.set(page, { x, y })
    }
    // Page.getLayoutMetrics is real geometry; window.screen* is fingerprint-spoofed.
    human.raw.move = async (x, y, options) => {
      await enqueue(async () => {
        await input(x, y)
        await move(x, y, options)
      })
    }
    const dispatch = (x: number, y: number, action: PointerAction, timeout: number) => {
      const deadline = Date.now() + timeout
      const previous = queue
      const work = enqueue(() => input(x, y, action, deadline))
      return beforeInputDeadline(() => previous, deadline).then(() => work)
    }
    nativeWheels.set(page, (x, y, direction, timeout) => dispatch(x, y, { wheel: direction }, timeout))
    nativeBacks.set(page, timeout => {
      const viewport = page.viewportSize() ?? { width: 800, height: 600 }
      const { x, y } = desktopCursors.get(page) ?? { x: viewport.width / 2, y: viewport.height / 2 }
      return dispatch(x, y, { back: true }, timeout)
    })
    void metrics.catch(() => {})
  }
  const close = () => {
    if (closed) return
    closed = true
    context.off('page', attach)
    for (const detach of detachMetrics) detach()
    for (const page of pages) {
      nativeWheels.delete(page)
      nativeBacks.delete(page)
      desktopCursors.delete(page)
    }
    pages.clear()
    socket.terminate()
  }
  try {
    for (const page of context.pages()) attach(page)
    // patchPage is idempotent, including pages already humanized during launch.
    context.on('page', attach)
    return close
  } catch (error) {
    close()
    throw error
  }
}
