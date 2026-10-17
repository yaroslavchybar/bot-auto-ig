import { errors, type Page } from 'playwright-core'
import { DEFAULT_SCREENING_SETTINGS, SCREENING_CHOICES, type ProfileScreeningSettings } from '../../shared/aiSettings.js'
import { currentScreeningSettings } from '../ai-settings.js'
import { BrowseSession } from './session.js'
import { assertInstagramReady } from './instagram-state.js'
import { requestOpenRouterDecision } from './openrouter-decision.js'
import { addLogContext } from '../../shared/logger.js'

/** Defaults for an automation that saved no screening settings; the UI shows and edits these. */
export const LEAD_SCREENING_MODEL = DEFAULT_SCREENING_SETTINGS.model
/** Skip when visible non-English text reaches this probability. */
export const LEAD_NON_ENGLISH_MIN_PROBABILITY = 0.7
/** Whole screening budget: one category request plus the male follow check. */
const SCREENING_TIMEOUT = 30_000
/** Jev rejects images wider than this, so a wider viewport is captured cropped. */
const MAX_IMAGE_WIDTH = 1568
export type LeadCategory = 'male' | 'female' | 'business'
/** `englishTextCheckPassed` is set only for male accounts; other categories never get the check. */
export type LeadDecision = {
  category: LeadCategory
  confidence: number
  model: string
  englishTextCheckPassed?: boolean
}
const categories = SCREENING_CHOICES
type DecisionOptions = { key?: string; fetcher?: typeof fetch }

/** The running automation's prompts and model order, with the built-in defaults as fallback. */
const state = (screenshot: Buffer, settings: ProfileScreeningSettings) => [
  settings.state,
  {
    type: 'image_url' as const,
    image_url: { url: `data:image/jpeg;base64,${screenshot.toString('base64')}` },
  },
]
const questions = (settings: ProfileScreeningSettings) => ({
  account_type: {
    type: 'choice',
    instructions: settings.instructions,
    criteria: settings.criteria,
  },
})

/** One model, one screenshot: the highest of male, female and business wins. */
async function classify(
  model: string,
  screenshot: Buffer,
  settings: ProfileScreeningSettings,
  timeout: number,
  options: DecisionOptions,
): Promise<Omit<LeadDecision, 'model'>> {
  const data = (await requestOpenRouterDecision({
    kind: 'lead', model, screenshot, timeout, ...options, errorPrefix: 'Lead decision provider',
    payload: {
      model,
      state: state(screenshot, settings),
      questions: questions(settings),
    },
  })) as {
    answers?: {
      account_type?: { type?: unknown; probabilities?: Record<string, unknown> }
    }
  }
  const answer = data?.answers?.account_type
  if (answer?.type !== 'choice') throw new Error('Invalid lead decision')
  const scores = categories.map((category) => answer.probabilities?.[category])
  if (
    !scores.every(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
    )
  )
    throw new Error('Invalid lead probabilities')
  const highest = Math.max(...scores)
  if (highest === 0 || scores.filter((score) => score === highest).length !== 1)
    throw new Error('Ambiguous lead probabilities')
  const best = scores.indexOf(highest)
  return { category: categories[best], confidence: scores[best] }
}

/** Reject only detected non-English text; missing text passes this language check. */
async function checkFollowEligibility(
  screenshot: Buffer,
  settings: ProfileScreeningSettings,
  timeout: number,
  options: DecisionOptions,
): Promise<boolean> {
  const data = (await requestOpenRouterDecision({
    kind: 'lead_follow_check', model: settings.followModel, screenshot, timeout, ...options,
    errorPrefix: 'Lead follow check provider',
    payload: {
      model: settings.followModel,
      state: state(screenshot, settings),
      questions: {
        non_english_text: { type: 'noul', instructions: settings.nonEnglishText },
      },
    },
  })) as { answers?: Record<string, { type?: unknown; noul?: unknown } | undefined> }
  const answer = data?.answers?.non_english_text
  if (
    answer?.type !== 'noul' ||
    typeof answer.noul !== 'number' ||
    !Number.isFinite(answer.noul) ||
    answer.noul < 0 ||
    answer.noul > 1
  )
    throw new Error('Invalid lead follow check')
  return answer.noul < LEAD_NON_ENGLISH_MIN_PROBABILITY
}

/**
 * Classify one profile from its screenshot alone: the highest of male, female and business wins.
 * The model reads username, full name, bio, profile picture and visible posts from that image.
 * A refused screening skips the lead for good; any other failure stays retryable.
 * A male account is then checked again for non-English text.
 */
export async function decideLead(
  screenshot: Buffer,
  timeout: number,
  options: { key?: string; fetcher?: typeof fetch } = {},
): Promise<LeadDecision> {
  const settings = currentScreeningSettings()
  addLogContext({ screeningModel: settings.model })
  const deadline = Date.now() + timeout
  const decision = {
    model: settings.model,
    ...(await classify(settings.model, screenshot, settings, timeout, options)),
  }
  if (decision.category !== 'male') return decision
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new errors.TimeoutError('Lead screening timed out before the follow-up check')
  return { ...decision, englishTextCheckPassed: await checkFollowEligibility(screenshot, settings, remaining, options) }
}

/** Capture the loaded recipient once, with the same session deadline as outreach. */
export async function screenLead(
  page: Page,
  username: string,
  session: BrowseSession,
  request = decideLead,
): Promise<LeadDecision> {
  const correctProfile = () =>
    new URL(page.url()).pathname.replaceAll('/', '').toLowerCase() === username.toLowerCase()
  session.check()
  if (!correctProfile()) throw new Error('Lead profile navigation changed')
  addLogContext({ screeningStage: 'profile_header' })
  await page.locator('main header').waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  addLogContext({ screeningStage: 'profile_username' })
  await page
    .locator('main header')
    .getByText(username, { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: session.timeout(5000) })
  await assertInstagramReady(page)
  addLogContext({ screeningStage: 'profile_avatar' })
  await page
    .locator('main header img')
    .first()
    .waitFor({ state: 'visible', timeout: session.timeout(3000) })
    .catch(() => {})
  session.check()
  addLogContext({ screeningStage: 'screenshot' })
  const captureStarted = Date.now()
  const viewport = page.viewportSize()
  const screenshot = await page.screenshot({
    type: 'jpeg',
    quality: 70,
    scale: 'css',
    fullPage: false,
    ...(viewport && {
      clip: {
        x: 0,
        y: 0,
        width: Math.min(viewport.width, MAX_IMAGE_WIDTH),
        height: viewport.height,
      },
    }),
    timeout: session.timeout(5000),
  })
  addLogContext({ screenshotCaptureMs: Date.now() - captureStarted, screenshotBytes: screenshot.length, screeningStage: 'provider' })
  if (!correctProfile()) throw new Error('Lead profile navigation changed')
  const result = await request(screenshot, session.timeout(SCREENING_TIMEOUT))
  session.check()
  if (!correctProfile()) throw new Error('Lead profile navigation changed')
  addLogContext({ screeningStage: 'complete' })
  return result
}
