import WebSocket from 'ws'
import { patchContext, resolveConfig } from 'cloakbrowser/human'
import type { BrowserContext, Page } from 'playwright-core'
import { runtimeHeaders, runtimeUrl } from '../shared/runtime.js'
import type { Display } from './display.js'

export type NativeWheel = (x: number, y: number, direction: 'up' | 'down', timeout: number) => Promise<void>
export type NativeDoubleClick = (x: number, y: number, timeout: number) => Promise<void>
type PointerAction = { wheel: 'up' | 'down' } | { doubleClick: true }
const nativeWheels = new WeakMap<Page, NativeWheel>()
const nativeDoubleClicks = new WeakMap<Page, NativeDoubleClick>()
const desktopCursors = new WeakMap<Page, Readonly<{ x: number; y: number }>>()

/** Headed automation pages can send discrete notches through their leased X11 display. */
export function nativeWheelFor(page: Page): NativeWheel | undefined { return nativeWheels.get(page) }
export function nativeDoubleClickFor(page: Page): NativeDoubleClick | undefined { return nativeDoubleClicks.get(page) }
export function desktopCursorFor(page: Page): Readonly<{ x: number; y: number }> | undefined { return desktopCursors.get(page) }

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

/** Sync the X11 pointer before Cloak's raw moves, including locator/handle clicks. */
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
  const pages = new Set<Page>()
  const enqueue = (action: () => Promise<void>) => {
    const work = queue.then(action)
    queue = work.catch(() => {})
    return work
  }
  const attach = (page: Page) => {
    pages.add(page)
    const move = page.mouse.move.bind(page.mouse)
    const metrics = context.newCDPSession(page)
    const input = async (x: number, y: number, action?: PointerAction, deadline = Infinity) => {
      const session = await beforeInputDeadline(() => metrics, deadline)
      const { cssLayoutViewport } = await beforeInputDeadline(() => session.send('Page.getLayoutMetrics'), deadline)
      if (Date.now() >= deadline) throw new Error('Native input deadline ended')
      // Once sent, keep the queue until the transport result; expiry cannot undo input.
      await request({ x, y, width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight,
        ...action })
      desktopCursors.set(page, { x, y })
    }
    // Page.getLayoutMetrics is real geometry; window.screen* is fingerprint-spoofed.
    page.mouse.move = async (x, y, options) => {
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
    nativeDoubleClicks.set(page, (x, y, timeout) => dispatch(x, y, { doubleClick: true }, timeout))
    void metrics.catch(() => {})
  }
  const close = () => {
    context.off('page', attach)
    for (const page of pages) {
      nativeWheels.delete(page)
      nativeDoubleClicks.delete(page)
      desktopCursors.delete(page)
    }
    pages.clear()
    socket.terminate()
  }
  try {
    for (const page of context.pages()) attach(page)
    // Register first so new tabs receive the native hook before Cloak captures raw methods.
    context.on('page', attach)
    patchContext(context, resolveConfig('careful'))
    return close
  } catch (error) {
    close()
    throw error
  }
}
