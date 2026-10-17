import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errors, type Page } from 'playwright-core'
import {
  decideLead,
  screenLead,
  LEAD_SCREENING_MODEL,
} from './lead-screening.js'
import { DecisionRefusedError } from './openrouter-decision.js'
import { DEFAULT_SCREENING_SETTINGS } from '../../shared/aiSettings.js'
import { currentLogScope } from '../../shared/logger.js'
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
      non_english_text: { type: 'noul', noul: 0.1 },
    },
  })
const followCheck = (nonEnglishText: number) =>
  Response.json({
    answers: {
      non_english_text: { type: 'noul', noul: nonEnglishText },
    },
  })
const refusal = () =>
  Response.json(
    { error: { message: 'The model refused to answer question account_type' } },
    { status: 502 },
  )
/** A Response body can only be read once, so every model call gets a fresh copy. */
const replay = (result: Response) => {
  let body: Promise<string> | undefined
  return (async () => {
    body ??= result.clone().text()
    return new Response(await body, { status: result.status })
  }) as typeof fetch
}
const options = (result: Response) => ({ key: 'fixture', fetcher: replay(result) })
/** Replays one response per model call, recording which model each call asked for. */
const chain = (results: Response[]) => {
  const asked: string[] = []
  const replies = results.map(replay)
  let call = 0
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    asked.push(JSON.parse(init.body as string).model)
    return replies[Math.min(call++, replies.length - 1)]!()
  }) as typeof fetch
  return { fetcher, asked }
}

test('screening sends the screenshot to the chosen model and scores all three categories from it', async () => {
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
    model: LEAD_SCREENING_MODEL,
  })
})

test('a refused screening skips the lead, and no other model is tried', async () => {
  const failing = chain([refusal()])
  await assert.rejects(
    decideLead(Buffer.from('jpeg'), 40_000, { key: 'fixture', fetcher: failing.fetcher }),
    DecisionRefusedError,
  )
  assert.deepEqual(failing.asked, [LEAD_SCREENING_MODEL])
})

test('a transient failure stays retryable rather than skipping the lead', async () => {
  await assert.rejects(
    decideLead(Buffer.from('jpeg'), 40_000, options(new Response('', { status: 503 }))),
    (error: unknown) => !(error instanceof DecisionRefusedError) && /HTTP 503/.test(String(error)),
  )
})

test('the whole screening budget covers one request even from a hanging provider', async () => {
  let calls = 0
  const started = Date.now()
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    calls++
    assert.ok(init.signal instanceof AbortSignal, 'every model attempt gets its own deadline')
    await new Promise((_, fail) => {
      init.signal!.addEventListener('abort', () => fail(new Error('aborted')))
    })
  }) as typeof fetch
  await assert.rejects(decideLead(Buffer.from('jpeg'), 400, { key: 'fixture', fetcher }))
  assert.equal(calls, 1)
  assert.ok(Date.now() - started < 2_000)
})

test('the follow-up request gets only the remaining screening budget', async () => {
  const now = Date.now
  let clock = now()
  const timeouts: unknown[] = []
  Date.now = () => clock
  try {
    const fetcher = (async () => {
      timeouts.push(currentLogScope()?.fields.timeoutMs)
      if (timeouts.length === 1) {
        clock += 750
        return response('male')
      }
      return followCheck(0.1)
    }) as typeof fetch
    await decideLead(Buffer.from('jpeg'), 1000, { key: 'fixture', fetcher })
    assert.deepEqual(timeouts, [1000, 250])
  } finally {
    Date.now = now
  }
})

test('an exhausted screening budget never starts the follow-up request', async () => {
  const now = Date.now
  let clock = now(), calls = 0
  Date.now = () => clock
  try {
    const fetcher = (async () => {
      calls++
      clock += 1000
      return response('male')
    }) as typeof fetch
    await assert.rejects(
      decideLead(Buffer.from('jpeg'), 1000, { key: 'fixture', fetcher }),
      errors.TimeoutError,
    )
    assert.equal(calls, 1)
  } finally {
    Date.now = now
  }
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
      category, confidence: 0.4, model: LEAD_SCREENING_MODEL,
      ...(category === 'male' ? { englishTextCheckPassed: true } : {}),
    })
  })

test('only a male lead is checked again by the strongest model, on the same screenshot, for non-English text', async () => {
  const asked: string[] = []
  const screenshots: string[] = []
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    asked.push(body.model)
    screenshots.push(body.state[1].image_url.url)
    return body.questions.non_english_text ? followCheck(0.05) : response('male')
  }) as typeof fetch
  assert.deepEqual(await decideLead(Buffer.from('male jpeg'), 100, { key: 'fixture', fetcher }), {
    category: 'male', confidence: 0.97, model: LEAD_SCREENING_MODEL, englishTextCheckPassed: true,
  })
  assert.deepEqual(asked, [LEAD_SCREENING_MODEL, DEFAULT_SCREENING_SETTINGS.followModel])
  assert.deepEqual(new Set(screenshots).size, 1)

  const female = []
  const femaleFetcher = (async (_url: unknown, init: RequestInit) => {
    female.push(JSON.parse(init.body as string).model)
    return response('female')
  }) as typeof fetch
  assert.equal(
    (await decideLead(Buffer.from('jpeg'), 100, { key: 'fixture', fetcher: femaleFetcher }))
      .englishTextCheckPassed,
    undefined,
  )
  assert.deepEqual(female, [LEAD_SCREENING_MODEL])
})

test('a male lead is skipped only when non-English text reaches 70% probability', async () => {
  for (const [confidence, expected] of [[0.7, false], [0.69, true], [0, true], [1, false]] as const) {
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      return body.questions.non_english_text ? followCheck(confidence) : response('male')
    }) as typeof fetch
    assert.equal(
      (await decideLead(Buffer.from('jpeg'), 100, { key: 'fixture', fetcher })).englishTextCheckPassed,
      expected,
      String(confidence),
    )
  }
})

test('a male lead whose non-English text check is missing or malformed is never approved', async () => {
  for (const answer of [
    undefined,
    { type: 'noul', noul: 2 },
    { type: 'noul', noul: -0.1 },
    { type: 'noul', noul: '0.9' },
    { type: 'choice', noul: 0.9 },
  ]) {
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      return body.questions.non_english_text
        ? Response.json({ answers: { non_english_text: answer } })
        : response('male')
    }) as typeof fetch
    await assert.rejects(
      decideLead(Buffer.from('jpeg'), 100, { key: 'fixture', fetcher }),
      /Invalid lead follow check/,
    )
  }
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
    model: LEAD_SCREENING_MODEL,
    englishTextCheckPassed: true,
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
    viewportSize: () => ({ width: 2400, height: 900 }),
    locator: (selector: string) =>
      selector.startsWith('main header')
        ? header
        : {
            filter: () => ({ evaluateAll: async () => null }),
          },
    screenshot: async (options: {
      type: string
      fullPage: boolean
      clip?: { x: number; y: number; width: number; height: number }
    }) => {
      assert.equal(headerReady, true)
      assert.equal(options.type, 'jpeg')
      assert.equal(options.fullPage, false)
      // Jev cannot read wider images, so the capture never exceeds its limit.
      assert.equal(options.clip?.width, 1568)
      captures++
      return Buffer.from('loaded profile screenshot')
    },
  } as unknown as Page
  await assert.rejects(
    screenLead(page, 'target', new BrowseSession(), async (screenshot) => {
      assert.equal(screenshot.toString(), 'loaded profile screenshot')
      url = 'https://www.instagram.com/different/'
      return { category: 'business', confidence: 1, model: LEAD_SCREENING_MODEL }
    }),
    /navigation changed/,
  )
  assert.equal(captures, 1)
})
