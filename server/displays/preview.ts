import { execFile } from 'node:child_process'
import { activeDisplays, type ActiveDisplaySession } from '../shared/store.js'
import { ExternalServiceError, NotFoundError } from '../shared/errors.js'
import { BROWSER_WINDOW_WIDTH, BROWSER_DESKTOP_HEIGHT } from '../browser/config.js'

// Capture the desktop without connecting a VNC client or disturbing the browser.
export function capturePreview(session: ActiveDisplaySession, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-f', 'x11grab', '-framerate', '10', '-draw_mouse', '0',
      '-probesize', '32', '-analyzeduration', '0',
      '-video_size', `${BROWSER_WINDOW_WIDTH}x${BROWSER_DESKTOP_HEIGHT}`,
      '-i', `:${session.displayNum}`, '-frames:v', '1',
      '-vf', 'scale=480:-2', '-c:v', 'mjpeg', '-q:v', '6',
      '-threads', '1', '-filter_threads', '1', '-f', 'image2pipe', 'pipe:1',
    ], { encoding: 'buffer', timeout: 5000, maxBuffer: 512 * 1024, signal }, (error, stdout) => {
      if (error || stdout.length === 0) {
        reject(new ExternalServiceError('Preview unavailable'))
      } else {
        resolve(stdout)
      }
    })
  })
}

// Share captures across viewers, cache briefly, and cap CPU use at two captures.
export function createPreviewCache(
  capture = capturePreview,
  sessions = activeDisplays,
  now = Date.now,
) {
  type Entry = { promise: Promise<Buffer>; expires: number; controller: AbortController; users: number }
  const cache = new Map<ActiveDisplaySession, Entry>()
  let running = 0
  const waiting: Array<() => void> = []
  const isActive = (session: ActiveDisplaySession) => [...sessions.values()].includes(session)

  async function run(session: ActiveDisplaySession, signal: AbortSignal): Promise<Buffer> {
    if (running >= 2) await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => {
        waiting.splice(waiting.indexOf(start), 1)
        reject(signal.reason)
      }
      waiting.push(start)
      signal.addEventListener('abort', abort, { once: true })
    })
    else running++
    try {
      signal.throwIfAborted()
      if (!isActive(session)) throw new NotFoundError('Display session ended')
      const image = await capture(session, signal)
      signal.throwIfAborted()
      if (!isActive(session)) throw new NotFoundError('Display session ended')
      return image
    } finally {
      const next = waiting.shift()
      if (next) next()
      else running--
    }
  }

  return (session: ActiveDisplaySession, signal?: AbortSignal): Promise<Buffer> => {
    if (signal?.aborted) return Promise.reject(signal.reason)
    for (const entry of cache.keys()) {
      if (!isActive(entry)) cache.delete(entry)
    }
    let entry = cache.get(session)
    if (!entry || now() >= entry.expires) {
      const fresh: Entry = {
        promise: Promise.resolve(Buffer.alloc(0)), expires: Infinity,
        controller: new AbortController(), users: 0,
      }
      fresh.promise = run(session, fresh.controller.signal).then((image) => {
        fresh.expires = now() + 8000
        return image
      }, (error: unknown) => {
        if (cache.get(session) === fresh) cache.delete(session)
        throw error
      })
      cache.set(session, fresh)
      entry = fresh
    }
    const shared = entry
    shared.users++
    // Each HTTP request can leave independently; only the last one cancels work.
    return new Promise<Buffer>((resolve, reject) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        shared.users--
        if (shared.users === 0 && shared.expires === Infinity) {
          if (cache.get(session) === shared) cache.delete(session)
          shared.controller.abort()
        }
      }
      const abort = () => { finish(); reject(signal?.reason) }
      signal?.addEventListener('abort', abort, { once: true })
      shared.promise.then(
        image => { finish(); resolve(image) },
        error => { finish(); reject(error) },
      )
    })
  }
}

export const getPreview = createPreviewCache()
