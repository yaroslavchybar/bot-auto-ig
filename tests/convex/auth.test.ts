import { expect, test } from 'vitest'

import { api } from '../../convex/_generated/api'
import { createUnauthenticatedConvexTest } from './helpers'

// Browser-called Convex functions are intentionally public: the admin-only
// gate lives in the Express session login, and the browser Convex client
// carries no identity since Clerk was removed.
test('allows unauthenticated public queries', async () => {
  const t = createUnauthenticatedConvexTest()

  await expect(t.query(api.lists.list, {})).resolves.toEqual([])
  await expect(t.query(api.profiles.queries.list, {})).resolves.toEqual([])
  await expect(t.query(api.workflows.queries.list, {})).resolves.toEqual([])
})

test('allows unauthenticated public mutations', async () => {
  const t = createUnauthenticatedConvexTest()

  await expect(
    t.mutation(api.messageTemplates.upsert, {
      kind: 'intro',
      texts: ['hello'],
    }),
  ).resolves.toBe(true)

  const created = await t.mutation(api.workflows.mutations.create, {
    name: 'Workflow A',
    nodes: [],
    edges: [],
  })

  expect(created).toMatchObject({ name: 'Workflow A' })
})
