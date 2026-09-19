import type { Locator } from 'playwright-core'
import { chance } from './shared.js'
import { BrowseSession } from './session.js'

/** Make each choice once, independent of how many wait ticks a post needs. */
export function postChoices(config: Record<string, unknown>) {
  return {
    like: chance(config.like_chance),
    follow: chance(config.follow_chance),
    carousel: chance(config.carousel_watch_chance),
  }
}

export function detourDelay(duration: number): number {
  return Math.max(30_000, duration / 4)
}

/** Count video playback, not buffering. Give up after three seconds without progress. */
export async function viewContent(target: Locator, ms: number, session: BrowseSession): Promise<boolean> {
  const video = target.locator('video').first()
  if (!await video.count()) {
    await session.wait(ms)
    return true
  }
  return viewVideo(video, ms, session)
}

export async function viewVideo(video: Locator, ms: number, session: BrowseSession): Promise<boolean> {
  let previous = await video.evaluate(v => (v as HTMLVideoElement).currentTime).catch(() => 0)
  let watched = 0
  let stalledAt = Date.now()
  while (watched < ms) {
    await session.wait(Math.min(250, ms - watched))
    const state = await video.evaluate(v => {
      const media = v as HTMLVideoElement
      return { time: media.currentTime, paused: media.paused, ended: media.ended }
    }).catch(() => null)
    if (!state) return false
    if (state.time !== previous && (!state.paused || state.ended)) {
      // Loop wraps count only the new clip's elapsed time, never the full duration.
      watched += Math.min(500, Math.max(0, state.time >= previous ? state.time - previous : state.time) * 1000)
      stalledAt = Date.now()
    }
    previous = state.time
    if (state.ended) return watched > 0
    if (Date.now() - stalledAt >= 3_000) return false
  }
  return true
}
