import { expect, test } from 'vite-plus/test'
import { api } from '../_generated/api'
import { defaultRoutine, validateRoutine } from '../routinePolicy'
import { createConvexTest, seedModel } from '../../tests/convex/helpers'

test('automation interest tags and rewritten intent persist and can be removed without restoring old topics', async () => {
  const t = createConvexTest(),
    list = await seedModel(t)
  const interests = [
    { label: 'fishing content', description: 'Fishing techniques, catches, and angling trips.' },
    { label: 'ecom income', description: 'Practical advice on earning income through e-commerce.' },
  ]
  const automation = await t.mutation(api.automations.mutations.create, {
    name: 'Interests',
    modelIds: [list!._id],
    routine: { ...defaultRoutine, interests },
  })
  expect(automation?.routine?.interests).toEqual(interests)
  await t.mutation(api.automations.mutations.update, {
    id: automation!._id,
    routine: { ...defaultRoutine, interests: [] },
  })
  expect(
    (await t.query(api.automations.queries.get, { id: automation!._id }))?.routine?.interests,
  ).toEqual([])
})

test('routine validation bounds tags and rejects duplicate or empty interpretations', () => {
  for (const interests of [
    [{ label: '', description: 'Fishing' }],
    [{ label: 'Fishing', description: '' }],
    [{ label: 'x'.repeat(301), description: 'Fishing' }],
    [{ label: 'Fishing', description: 'x'.repeat(1001) }],
    [
      { label: 'Fishing', description: 'Fishing' },
      { label: ' fishing ', description: 'Angling' },
    ],
    Array.from({ length: 21 }, (_, i) => ({ label: `Tag ${i}`, description: 'Fishing' })),
  ])
    expect(() => validateRoutine({ ...defaultRoutine, interests })).toThrow()
})
