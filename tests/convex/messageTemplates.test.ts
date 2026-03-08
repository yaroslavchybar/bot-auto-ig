import { expect, test } from 'vitest'

import { api } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'

test('upserts and reads cleaned message template text arrays', async () => {
  const t = createConvexTest()

  await t.mutation(api.messageTemplates.upsert, {
    kind: 'intro',
    texts: ['Hello', '', '  Welcome  '],
  })
  const texts = await t.query(api.messageTemplates.get, { kind: 'intro' })

  expect(texts).toEqual(['Hello', '  Welcome  '])
})
