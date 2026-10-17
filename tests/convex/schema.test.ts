import { expect, test } from 'vite-plus/test'

import { api } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'

test('boots convex-test against the schema and accepts table operations', async () => {
  const t = createConvexTest()
  const list = await t.mutation(api.models.create, { name: 'Schema Smoke' })
  const rows = await t.query(api.models.list, {})

  expect(list?.name).toBe('Schema Smoke')
  expect(rows).toHaveLength(1)
})
