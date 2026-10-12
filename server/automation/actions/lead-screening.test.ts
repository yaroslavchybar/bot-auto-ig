import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { decideLead, screenLead, LEAD_SCREENING_MODEL } from './lead-screening.js'
import { BrowseSession } from './session.js'

const response = (category: string, evidence = 1, confidence = 0.97) =>
  Response.json({
    answers: {
      account_type: {
        type: 'choice',
        probabilities: Object.fromEntries(
          ['male', 'female', 'business', 'unknown'].map((value) => [
            value,
            value === category ? confidence : (1 - confidence) / 3,
          ]),
        ),
      },
      explicit_gender: { type: 'noul', noul: evidence },
    },
  })
const options = (result: Response) => ({
  key: 'fixture',
  fetcher: (async () => result) as typeof fetch,
})

test('screening sends the screenshot to Luna Decisions with explicit-text gender criteria', async () => {
  const screenshot = Buffer.from('screenshot bytes')
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    assert.equal(body.model, LEAD_SCREENING_MODEL)
    assert.deepEqual(body.state[1], {
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${screenshot.toString('base64')}` },
    })
    assert.match(body.questions.account_type.instructions, /Never infer gender/)
    assert.match(body.questions.explicit_gender.instructions, /pronouns alone/)
    return response('business', 0)
  }) as typeof fetch
  assert.deepEqual(await decideLead(screenshot, 5000, { key: 'fixture', fetcher }), {
    category: 'business',
    confidence: 0.97,
  })
})

for (const category of ['male', 'female'])
  test(`${category} requires explicit public self-description`, async () => {
    assert.equal(
      (await decideLead(Buffer.from('jpeg'), 100, options(response(category, 0)))).category,
      'unknown',
    )
    assert.equal(
      (await decideLead(Buffer.from('jpeg'), 100, options(response(category, 1)))).category,
      category,
    )
    assert.equal(
      (await decideLead(Buffer.from('jpeg'), 100, options(response(category, 1, 0.79)))).category,
      'unknown',
    )
  })

test('missing or malformed decisions never approve a lead', async () => {
  for (const result of [
    Response.json(null),
    Response.json({ answers: {} }),
    response('business', 0, 2),
    new Response('', { status: 503 }),
  ])
    await assert.rejects(decideLead(Buffer.from('jpeg'), 100, options(result)))
  await assert.rejects(decideLead(Buffer.from('jpeg'), 100, { key: '' }), /key is missing/)
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
