import { readdirSync } from 'node:fs'

import { expect, test } from 'vitest'

const expectedModules = [
  'convex.config.ts',
  'crons.ts',
  'http.ts',
  'instagramAccounts.ts',
  'lists.ts',
  'messageTemplates.ts',
  'schema.ts',
  'scrapingAccounts.ts',
  'workflowArtifacts.ts',
]

test('matches the owned top-level convex module cohort', () => {
  const root = new URL('../../convex/', import.meta.url)
  const actualModules = readdirSync(root)
    .filter((entry) => entry.endsWith('.ts'))
    .sort()

  expect(actualModules).toEqual(expectedModules)
})
