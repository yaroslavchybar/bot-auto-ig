import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator } from 'playwright-core'
import { withAiSettings, currentAiStep, currentScreeningSettings } from './ai-settings.js'
import { DecisionRefusedError } from './actions/openrouter-decision.js'
import {
  AI_DEFAULTS,
  DEFAULT_SCREENING_SETTINGS,
  validateAiSettings,
  type AiSettings,
} from '../shared/aiSettings.js'
import { decideTopic, createTopicMatcher } from './actions/topic-intent.js'
import { decideLeadPostGrid } from './actions/lead-post-decision.js'
import { decideLead } from './actions/lead-screening.js'
import { BrowseSession } from './actions/session.js'

test('concurrent automations use their own prompts and models in actual decision requests', async () => {
  const requests: Array<{ model: string; questions: Record<string, { instructions: string }> }> = []
  const image = Buffer.from('fixture image')
  const run = (model: string, prompt: string) =>
    withAiSettings(
      {
        interestMatch: { model, prompt },
        leadPostPerson: { model, prompt: prompt + ' person' },
      },
      async () => {
        await Promise.resolve()
        const fetcher = (async (_url: unknown, init: RequestInit) => {
          const body = JSON.parse(String(init.body))
          requests.push(body)
          const question = Object.keys(body.questions)[0]
          return Response.json({ answers: { [question]: { type: 'noul', noul: 0.9 } } })
        }) as typeof fetch
        assert.equal(
          (
            await decideTopic({ topics: ['Fishing'], screenshot: image }, 5000, {
              key: 'test',
              fetcher,
            })
          ).related,
          true,
        )
        assert.deepEqual(await decideLeadPostGrid(image, 1, 5000, { key: 'test', fetcher }), [1])
      },
    )
  await Promise.all([run('liquid/d1-ultra', 'Fishing only'), run('respan/span-02', 'Cooking only')])
  assert.deepEqual(
    requests.map((body) => [body.model, Object.values(body.questions)[0].instructions]).sort(),
    [
      ['liquid/d1-ultra', 'Fishing only'],
      ['liquid/d1-ultra', 'Fishing only person'],
      ['respan/span-02', 'Cooking only'],
      ['respan/span-02', 'Cooking only person'],
    ],
  )
  assert.deepEqual(currentAiStep('interestMatch'), AI_DEFAULTS.interestMatch)
})

test('changing an automation prompt invalidates its cached content decision', async () => {
  let calls = 0
  const matcher = createTopicMatcher(
    async () => {
      calls++
      return { confidence: 0.9, related: true }
    },
    async () => Buffer.from('image'),
  )
  const target = { page: () => ({}) } as unknown as Locator
  const context = { text: 'Fishing', relationship: 'unknown' as const }
  const run = (prompt: string) =>
    withAiSettings({ interestMatch: { model: 'liquid/d1-ultra', prompt } }, () =>
      matcher(context, ['Fishing'], new BrowseSession(), () => {}, target),
    )
  await run('First prompt')
  await run('First prompt')
  assert.equal(calls, 1)
  await run('Changed prompt')
  assert.equal(calls, 2)
})

test('AI settings reject blank or oversized prompts, unknown steps and unsupported models', () => {
  for (const settings of [
    { interestMatch: { model: 'liquid/d1-ultra', prompt: ' ' } },
    { interestMatch: { model: 'liquid/d1-ultra', prompt: 'x'.repeat(10_001) } },
    { interestMatch: { model: 'missing/model', prompt: 'Fishing' } },
    { unexpected: { model: 'liquid/d1-ultra', prompt: 'Fishing' } },
  ])
    assert.throws(() => validateAiSettings(settings as AiSettings))
})

test('saved screening prompts and model order drive the real screening request', async () => {
  const requests: Array<{ model: string; state: string[]; questions: Record<string, unknown> }> = []
  const image = Buffer.from('fixture image')
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    requests.push(body)
    return Response.json({
      answers: {
        account_type: {
          type: 'choice',
          probabilities: { male: 0.9, female: 0.05, business: 0.05 },
        },
        non_english_text: { type: 'noul', noul: 0.05 },
      },
    })
  }) as typeof fetch
  const decision = await withAiSettings(
    {
      profileScreening: {
        model: 'typesafe/jev-1.14',
        followModel: 'typesafe/jev-1.14',
        state: 'Custom state text.',
        instructions: 'Custom category question.',
        criteria: { male: 'Custom male choice.' },
        nonEnglishText: 'Custom non-English text question.',
      },
    },
    async () => {
      assert.deepEqual(currentScreeningSettings().criteria, {
        male: 'Custom male choice.',
        female: DEFAULT_SCREENING_SETTINGS.criteria.female,
        business: DEFAULT_SCREENING_SETTINGS.criteria.business,
      })
      return decideLead(image, 5000, { key: 'test', fetcher })
    },
  )
  assert.deepEqual(decision, {
    model: 'typesafe/jev-1.14',
    category: 'male',
    confidence: 0.9,
    englishTextCheckPassed: true,
  })
  // Untouched fields keep their default wording.
  assert.deepEqual(requests[0], {
    model: 'typesafe/jev-1.14',
    state: ['Custom state text.', { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } }],
    questions: {
      account_type: {
        type: 'choice',
        instructions: 'Custom category question.',
        criteria: {
          male: 'Custom male choice.',
          female: DEFAULT_SCREENING_SETTINGS.criteria.female,
          business: DEFAULT_SCREENING_SETTINGS.criteria.business,
        },
      },
    },
  })
  assert.deepEqual(requests[1], {
    model: 'typesafe/jev-1.14',
    state: ['Custom state text.', { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } }],
    questions: {
      non_english_text: { type: 'noul', instructions: 'Custom non-English text question.' },
    },
  })
})

test('a refused screening skips the lead and any other failure stays retryable', async () => {
  const attempts: string[] = []
  const run = (result: () => Response) => {
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      attempts.push(JSON.parse(String(init.body)).model)
      return result()
    }) as typeof fetch
    return withAiSettings({ profileScreening: { model: 'typesafe/jev-1.14' } }, () =>
      decideLead(Buffer.from('jpeg'), 5000, { key: 'test', fetcher }),
    )
  }
  await assert.rejects(
    run(() =>
      Response.json(
        { error: { message: 'The model refused to answer question account_type' } },
        { status: 502 },
      ),
    ),
    DecisionRefusedError,
  )
  await assert.rejects(run(() => new Response('', { status: 503 })), /HTTP 503/)
  // One model, one attempt: no other model is tried.
  assert.deepEqual(attempts, ['typesafe/jev-1.14', 'typesafe/jev-1.14'])
})

test('screening settings reject unsupported models and blank prompts', () => {
  const valid = DEFAULT_SCREENING_SETTINGS
  for (const screening of [
    { model: 'missing/model' },
    { followModel: 'missing/model' },
    { instructions: ' ' },
    { criteria: { male: '' } },
    { nonEnglishText: 'x'.repeat(10_001) },
    { nonEnglishText: ' ' },
  ])
    assert.throws(
      () => validateAiSettings({ profileScreening: screening } as AiSettings),
      /decision model|prompt must be/i,
    )
  // A partial override that only swaps the model is valid.
  validateAiSettings({ profileScreening: { model: valid.followModel } })
})
