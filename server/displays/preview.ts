import { execFile } from 'node:child_process'
import { activeDisplays, type ActiveDisplaySession } from '../shared/store.js'
import { ExternalServiceError, NotFoundError } from '../shared/errors.js'
import { BROWSER_WINDOW_WIDTH, BROWSER_DESKTOP_HEIGHT } from '../browser/config.js'

// Capture the desktop without connecting a VNC client or disturbing the browser.
export function capturePreview(session: ActiveDisplaySession): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-f', 'x11grab', '-framerate', '10', '-draw_mouse', '0',
      '-probesize', '32', '-analyzeduration', '0',
      '-video_size', `${BROWSER_WINDOW_WIDTH}x${BROWSER_DESKTOP_HEIGHT}`,
      '-i', `:${session.displayNum}`, '-frames:v', '1',
      '-vf', 'scale=480:-2', '-c:v', 'mjpeg', '-q:v', '6',
      '-threads', '1', '-filter_threads', '1', '-f', 'image2pipe', 'pipe:1',
    ], { encoding: 'buffer', timeout: 5000, maxBuffer: 512 * 1024 }, (error, stdout) => {
      if (error || stdout.length === 0) {
        reject(new ExternalServiceError('Preview unavailable'))
      } else {
        resolve(`data:image/jpeg;base64,${stdout.toString('base64')}`)
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
  const cache = new Map<ActiveDisplaySession, { promise: Promise<string>; expires: number }>()
  let running = 0
  const waiting: Array<() => void> = []
  const isActive = (session: ActiveDisplaySession) => [...sessions.values()].includes(session)

  async function run(session: ActiveDisplaySession): Promise<string> {
    if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
    else running++
    try {
      if (!isActive(session)) throw new NotFoundError('Display session ended')
      const image = await capture(session)
      if (!isActive(session)) throw new NotFoundError('Display session ended')
      return image
    } finally {
      const next = waiting.shift()
      if (next) next()
      else running--
    }
  }

  return (session: ActiveDisplaySession): Promise<string> => {
    for (const entry of cache.keys()) {
      if (!isActive(entry)) cache.delete(entry)
    }
    const cached = cache.get(session)
    if (cached && now() < cached.expires) return cached.promise
    const entry = { promise: Promise.resolve(''), expires: Infinity }
    entry.promise = run(session).then((image) => {
      entry.expires = now() + 8000
      return image
    }, (error: unknown) => {
      cache.delete(session)
      throw error
    })
    cache.set(session, entry)
    return entry.promise
  }
}

export const getPreview = createPreviewCache()
