import { watchScraperWork, type ScraperWork } from '../shared/convexRealtime.js'
import { runtimeRequest } from '../shared/runtime.js'
import logger from '../shared/logger.js'

/** Relay Convex queue changes; Rust owns scraping, batching and enrichment. */
export function startScraperWorker(): () => void {
  let latest: ScraperWork = { jobAt: null, jobKey: null, enrichmentKey: null }
  let revision = 0,
    sent = -1,
    busy = false,
    stopped = false
  let pending: Promise<unknown> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = async () => {
    if (busy || stopped) return
    busy = true
    try {
      while (!stopped && sent !== revision) {
        const current = revision
        pending = runtimeRequest('/scraper/work', { method: 'POST', body: JSON.stringify(latest) })
        await pending
        pending = undefined
        sent = current
      }
    } catch (error) {
      logger.error({
        event: 'scraper.bridge_failed',
        error,
        message: 'Could not update Rust scraper work',
        outcome: 'error',
      })
      if (!stopped) {
        timer = setTimeout(() => {
          void flush()
        }, 3000)
        timer.unref?.()
      }
    } finally {
      busy = false
    }
  }
  const update = (state: ScraperWork) => {
    latest = state
    revision++
    if (timer) clearTimeout(timer)
    void flush()
  }
  const subscription = watchScraperWork(update, (error) => {
    update({ jobAt: null, jobKey: null, enrichmentKey: null })
    logger.error({
      event: 'scraper.subscription_failed',
      error,
      message: 'Scraper subscription failed',
      outcome: 'error',
    })
  })
  void subscription.initial.catch(() => undefined)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    subscription.unsubscribe()
    void (async () => {
      await pending?.catch(() => {})
      await runtimeRequest('/scraper/work', {
        method: 'POST',
        body: JSON.stringify({ jobAt: null, jobKey: null, enrichmentKey: null }),
      })
    })().catch(() => {})
  }
}
