import { expect, test } from 'vitest'

import { api } from '../../convex/_generated/api'
import { createUnauthenticatedConvexTest } from './helpers'

test('rejects unauthenticated public queries', async () => {
  const t = createUnauthenticatedConvexTest()

  await expect(t.query(api.lists.list, {})).rejects.toThrow('Unauthorized')
  await expect(t.query(api.profiles.list, {})).rejects.toThrow('Unauthorized')
  await expect(t.query(api.workflows.list, {})).rejects.toThrow('Unauthorized')
})

test('rejects unauthenticated public mutations', async () => {
  const t = createUnauthenticatedConvexTest()

  await expect(
    t.mutation(api.messageTemplates.upsert, {
      kind: 'intro',
      texts: ['hello'],
    }),
  ).rejects.toThrow('Unauthorized')

  await expect(
    t.mutation(api.workflows.create, {
      name: 'Workflow A',
      nodes: [],
      edges: [],
    }),
  ).rejects.toThrow('Unauthorized')
})
