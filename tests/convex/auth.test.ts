import { expect, test } from 'vite-plus/test'

import { defaultRoutine } from '../../convex/routinePolicy'
import { api } from '../../convex/_generated/api'
import { createUnauthenticatedConvexTest } from './helpers'

// Browser-called Convex functions are intentionally public: the admin-only
// gate lives in the Express session login, and the browser Convex client
// carries no identity since Clerk was removed.
test('allows unauthenticated public queries', async () => {
  const t = createUnauthenticatedConvexTest()

  await expect(t.query(api.models.list, {})).resolves.toEqual([])
  await expect(t.query(api.profiles.queries.list, {})).resolves.toEqual([])
  await expect(t.query(api.automations.queries.list, {})).resolves.toEqual([])
})

test('allows unauthenticated public mutations', async () => {
  const t = createUnauthenticatedConvexTest()

  const model = await t.mutation(api.models.create, { name: 'Model' })
  const created = await t.mutation(api.automations.mutations.create, {
    name: 'Automation A', routine: defaultRoutine, modelIds: [model!._id],
    })

  expect(created).toMatchObject({ name: 'Automation A' })
})
