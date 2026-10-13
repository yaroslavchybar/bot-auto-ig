import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { decideLead, screenLead, LEAD_SCREENING_MODEL } from './lead-screening.js'
import { BrowseSession } from './session.js'

const response = (category: string, confidence = 0.97) =>
  Response.json({
    answers: {
      account_type: {
        type: 'choice',
        probabilities: Object.fromEntries(
          ['male', 'female', 'business'].map((value) => [
            value,
            value === category ? confidence : (1 - confidence) / 2,
          ]),
        ),
      },
    },
  })
const options = (result: Response) => ({
  key: 'fixture',
  fetcher: (async () => result) as typeof fetch,
})

test('screening sends the screenshot to Luna Decisions and scores all three categories from it', async () => {
  const screenshot = Buffer.from('screenshot bytes')
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    assert.equal(body.model, LEAD_SCREENING_MODEL)
    assert.deepEqual(body.state[1], {
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${screenshot.toString('base64')}` },
    })
    assert.deepEqual(Object.keys(body.questions), ['account_type'])
    assert.deepEqual(Object.keys(body.questions.account_type.criteria), ['male', 'female', 'business'])
    for (const signal of ['username', 'full name', 'bio', 'profile picture', 'visible posts'])
      assert.match(body.questions.account_type.instructions, new RegExp(signal))
    return response('business')
  }) as typeof fetch
  assert.deepEqual(await decideLead(screenshot, 5000, { key: 'fixture', fetcher }), {
    category: 'business',
    confidence: 0.97,
  })
})

test('missing or malformed decisions never approve a lead', async () => {
  for (const result of [
    Response.json(null),
    Response.json({ answers: {} }),
    response('business', 2),
    new Response('', { status: 503 }),
  ])
    await assert.rejects(decideLead(Buffer.from('jpeg'), 100, options(result)))
  await assert.rejects(decideLead(Buffer.from('jpeg'), 100, { key: '' }), /key is missing/)
})

test('all-zero scores and ties for the highest score never approve a lead', async () => {
  for (const scores of [
    [0, 0, 0],
    [1 / 3, 1 / 3, 1 / 3],
    [0.5, 0.5, 0],
    [0.5, 0, 0.5],
    [0, 0.5, 0.5],
  ]) {
    const result = Response.json({
      answers: {
        account_type: {
          type: 'choice',
          probabilities: Object.fromEntries(
            ['male', 'female', 'business'].map((category, index) => [category, scores[index]]),
          ),
        },
      },
    })
    await assert.rejects(
      decideLead(Buffer.from('jpeg'), 100, options(result)),
      /Ambiguous lead probabilities/,
    )
  }
})

for (const category of ['male', 'female', 'business'] as const)
  test(`the highest ${category} score wins without a category confidence cutoff`, async () => {
    assert.deepEqual(await decideLead(Buffer.from('jpeg'), 100, options(response(category, 0.4))), {
      category, confidence: 0.4,
    })
  })

test('a lead is classified from screenshot evidence alone, never from a text evidence answer', async () => {
  const screenshot = Buffer.from('profile screenshot')
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    assert.equal(body.questions.explicit_gender, undefined)
    return response('male', 0.9)
  }) as typeof fetch
  assert.deepEqual(await decideLead(screenshot, 100, { key: 'fixture', fetcher }), {
    category: 'male',
    confidence: 0.9,
  })
})

test('a changed recipient or stopped session cannot capture or classify the wrong profile', async () => {
  const page = { url: () => 'https://www.instagram.com/other/' } as Page
  await assert.rejects(screenLead(page, 'target', new BrowseSession()), /navigation changed/)
  await assert.rejects(screenLead(page, 'target', new BrowseSession(0)), /session ended/)
})

test('screening waits for the target header, captures once, and rejects navigation during classification', async () => {
  let url = 'https://www.instagram.com/target/',
    captures = 0,
    headerReady = false
  const header = {
    waitFor: async () => {
      headerReady = true
    },
    first() {
      return this
    },
    getByText: (username: string) => {
      assert.equal(username, 'target')
      return header
    },
  }
  const page = {
    url: () => url,
    locator: (selector: string) =>
      selector.startsWith('main header')
        ? header
        : {
            filter: () => ({ evaluateAll: async () => null }),
          },
    screenshot: async (options: { type: string; fullPage: boolean }) => {
      assert.equal(headerReady, true)
      assert.equal(options.type, 'jpeg')
      assert.equal(options.fullPage, false)
      captures++
      return Buffer.from('loaded profile screenshot')
    },
  } as unknown as Page
  await assert.rejects(
    screenLead(page, 'target', new BrowseSession(), async (screenshot) => {
      assert.equal(screenshot.toString(), 'loaded profile screenshot')
      url = 'https://www.instagram.com/different/'
      return { category: 'business', confidence: 1 }
    }),
    /navigation changed/,
  )
  assert.equal(captures, 1)
})
