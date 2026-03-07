import { expect, test } from 'vitest'

import { api } from '../_generated/api'
import { createConvexTest } from './helpers'

test('boots convex-test against the schema and accepts table operations', async () => {
  const t = createConvexTest()
  const list = await t.mutation(api.lists.create, { name: 'Schema Smoke' })
  const rows = await t.query(api.lists.list, {})

  expect(list?.name).toBe('Schema Smoke')
  expect(rows).toHaveLength(1)
})
