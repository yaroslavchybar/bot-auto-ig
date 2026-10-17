import { expect, test } from 'vite-plus/test'
import { api } from '../_generated/api'
import { defaultRoutine } from '../routinePolicy'
import { createConvexTest, seedModel } from '../../tests/convex/helpers'

test('AI settings save per automation and reset without affecting another automation', async () => {
  const t = createConvexTest(),
    first = await seedModel(t),
    second = await seedModel(t, 'Second model')
  const ai = { interestMatch: { model: 'liquid/d1-ultra', prompt: 'Only fishing activities.' } }
  const a = await t.mutation(api.automations.mutations.create, {
    name: 'First',
    nodes: [],
    edges: [],
    modelIds: [first!._id],
    routine: { ...defaultRoutine, ai },
  })
  const b = await t.mutation(api.automations.mutations.create, {
    name: 'Second',
    nodes: [],
    edges: [],
    modelIds: [second!._id],
    routine: defaultRoutine,
  })
  expect(a?.routine?.ai).toEqual(ai)
  expect(b?.routine?.ai).toBeUndefined()
  await t.mutation(api.automations.mutations.update, {
    id: a!._id,
    routine: { ...defaultRoutine, ai: {} },
  })
  expect((await t.query(api.automations.queries.get, { id: a!._id }))?.routine?.ai).toEqual({})
})

test('saved profile screening prompts and models round-trip and reject unusable ones', async () => {
  const t = createConvexTest(),
    list = await seedModel(t)
  const profileScreening = {
    model: 'typesafe/jev-1.14',
    followModel: 'typesafe/jev-1.14',
    state: 'Custom state text.',
    instructions: 'Custom category question.',
    criteria: {
      male: 'Custom male choice.',
      female: 'Custom female choice.',
      business: 'Custom business choice.',
    },
    nonEnglishText: 'Custom non-English text question.',
  }
  const created = await t.mutation(api.automations.mutations.create, {
    name: 'Screening',
    nodes: [],
    edges: [],
    modelIds: [list!._id],
    routine: { ...defaultRoutine, ai: { profileScreening } },
  })
  expect(created?.routine?.ai?.profileScreening).toEqual(profileScreening)
  // A partial override stays partial and keeps the built-in wording for everything else.
  await t.mutation(api.automations.mutations.update, {
    id: created!._id,
    routine: { ...defaultRoutine, ai: { profileScreening: { model: 'liquid/d1-ultra' } } },
  })
  expect(
    (await t.query(api.automations.queries.get, { id: created!._id }))?.routine?.ai?.profileScreening,
  ).toEqual({ model: 'liquid/d1-ultra' })
  for (const screening of [
    { model: 'missing/model' },
    { followModel: 'missing/model' },
    { instructions: ' ' },
    { nonEnglishText: 'x'.repeat(10_001) },
    { nonEnglishText: ' ' },
  ])
    await expect(
      t.mutation(api.automations.mutations.update, {
        id: created!._id,
        routine: { ...defaultRoutine, ai: { profileScreening: screening } },
      }),
    ).rejects.toThrow(/decision model|prompt must be/)
})
