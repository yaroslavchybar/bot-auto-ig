import { currentAiStep } from '../ai-settings.js'
import { DEFAULT_DECISION_MODEL } from '../../shared/aiSettings.js'
import type { FeedPostContext } from '../../shared/warmupTopics.js'
import { BrowseSession, SessionEnded } from './session.js'
import type { ActionLogger } from './shared.js'
import { requestOpenRouterDecision } from './openrouter-decision.js'
import { beginSessionDecision } from './session-decision.js'

export const TOPIC_MODEL = DEFAULT_DECISION_MODEL
export const TOPIC_CONFIDENCE = 0.7
export const TOPIC_DECISION_TIMEOUT = 5000
export type TopicContext = Pick<FeedPostContext, 'text' | 'relationship'>
export type TopicInput = { topics: readonly string[]; screenshot: Buffer }
export type TopicDecision = { related: boolean; confidence: number }
export type TopicMatcher = (
  context: TopicContext,
  topics: readonly string[],
  session: BrowseSession,
  log: ActionLogger,
  target: Locator,
) => Promise<boolean>

/** Classify visible subject matter from an image using the same format as lead screening. */
export async function decideTopic(
  input: TopicInput,
  timeout = TOPIC_DECISION_TIMEOUT,
  options: { key?: string; fetcher?: typeof fetch } = {},
): Promise<TopicDecision> {
  const settings = currentAiStep('interestMatch')
  const state = [
    JSON.stringify({ topics: input.topics }),
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.screenshot.toString('base64')}` } },
  ]
  const data = await requestOpenRouterDecision({
    kind: 'topic', model: settings.model, screenshot: input.screenshot, timeout, ...options, errorPrefix: 'Topic provider',
    payload: {
      model: settings.model,
      state,
      questions: {
        matches_topic: {
          type: 'noul',
          instructions: settings.prompt,
        },
      },
    },
  }) as {
    answers?: { matches_topic?: { type?: unknown; noul?: unknown } }
  } | null
  const answer = data?.answers?.matches_topic
  const confidence = answer?.noul
  if (
    answer?.type !== 'noul' ||
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  )
    throw new Error('Topic provider returned an invalid decision')
  return { related: confidence >= TOPIC_CONFIDENCE, confidence }
}

/** Capture only the target's visible area, without auto-scrolling or saving an image to disk. */
export async function captureTopicScreenshot(target: Locator, session: BrowseSession): Promise<Buffer> {
  session.check()
  const element = await target.elementHandle({ timeout: session.timeout(3000) })
  if (!element) throw new Error('Topic content is unavailable')
  try {
    const page = target.page()
    const viewport = page.viewportSize()
    const box = await element.boundingBox()
    if (!viewport || !box) throw new Error('Topic content is not visible')
    const x = Math.max(0, box.x), y = Math.max(0, box.y)
    const width = Math.min(viewport.width, box.x + box.width) - x
    const height = Math.min(viewport.height, box.y + box.height) - y
    if (width <= 0 || height <= 0) throw new Error('Topic content is outside the viewport')
    const screenshot = await page.screenshot({
      type: 'jpeg', quality: 70, scale: 'css', fullPage: false,
      // Keep comment-field styles untouched; Playwright otherwise hides and restores every caret.
      caret: 'initial',
      clip: { x, y, width, height }, timeout: session.timeout(5000),
    })
    session.check()
    if (!await element.evaluate(node => node.isConnected)) throw new Error('Topic content detached during capture')
    return screenshot
  } finally { await element.dispose().catch(() => {}) }
}

/** Reuse the same item's decision for viewing and engagement; never cache across changing DOM items. */
export function createTopicMatcher(request = decideTopic, capture = captureTopicScreenshot,
  minimumConfidence = TOPIC_CONFIDENCE): TopicMatcher {
  const cache = new WeakMap<TopicContext, Map<string, Promise<boolean>>>()
  return (context, topics, session, log, target) => {
    session.check()
    if (!topics.length) return Promise.resolve(false)
    const settings = currentAiStep('interestMatch')
    const key = JSON.stringify([settings, [...topics].sort(), context.text.slice(0, 6000)])
    let decisions = cache.get(context)
    if (!decisions) {
      decisions = new Map()
      cache.set(context, decisions)
    }
    const previous = decisions.get(key)
    if (previous) return previous
    const pending = (async () => {
      const page = target.page()
      const report = beginSessionDecision(page, { kind: 'interest', status: 'checking' })
      try {
        const deadline = Math.min(session.end, Date.now() + TOPIC_DECISION_TIMEOUT)
        const captureSession = new BrowseSession(deadline, () => session.stopped())
        const screenshot = await capture(target, captureSession)
        captureSession.check()
        const decision = await request({ topics, screenshot }, captureSession.timeout(TOPIC_DECISION_TIMEOUT))
        captureSession.check()
        session.check()
        const related = decision.related && decision.confidence >= minimumConfidence
        report({ kind: 'interest', status: 'complete',
          confidence: decision.confidence, related })
        log({
          event: 'automation.warmup.topic_decision',
          model: settings.model,
          related,
          confidence: decision.confidence,
          input: 'screenshot',
        })
        return related
      } catch {
        report({ kind: 'interest', status: 'unavailable' })
        if (session.stopped())
          throw new SessionEnded('Browsing session ended')
        log({
          event: 'automation.warmup.topic_decision_failed',
          model: settings.model,
          reason: 'Topic decision unavailable',
        })
        return false
      }
    })()
    decisions.set(key, pending)
    return pending
  }
}

export const topicContentMatches = createTopicMatcher()
import type { Locator } from 'playwright-core'
