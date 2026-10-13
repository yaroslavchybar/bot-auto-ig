import WebSocket from 'ws'
import { patchContext, resolveConfig } from 'cloakbrowser/human'
import type { BrowserContext, Page } from 'playwright-core'
import { runtimeHeaders, runtimeUrl } from '../shared/runtime.js'
import type { Display } from './display.js'

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
  const attach = (page: Page) => {
    const move = page.mouse.move.bind(page.mouse)
    const metrics = context.newCDPSession(page)
    // Page.getLayoutMetrics is real geometry; window.screen* is fingerprint-spoofed.
    page.mouse.move = async (x, y, options) => {
      const work = queue.then(async () => {
        const session = await metrics
        const { cssLayoutViewport } = await session.send('Page.getLayoutMetrics')
        await request({
          x,
          y,
          width: cssLayoutViewport.clientWidth,
          height: cssLayoutViewport.clientHeight,
        })
        await move(x, y, options)
      })
      queue = work.catch(() => {})
      return work
    }
    void metrics.catch(() => {})
  }
  const close = () => {
    context.off('page', attach)
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
