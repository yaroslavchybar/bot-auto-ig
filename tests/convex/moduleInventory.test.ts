import { readdirSync } from 'node:fs'

import { expect, test } from 'vitest'

const expectedModules = [
  'auth.config.ts',
  'auth.ts',
  'convex.config.ts',
  'crons.ts',
  'http.ts',
  'httpApi.ts',
  'instagramAccounts.ts',
  'keywords.ts',
  'lists.ts',
  'messageTemplates.ts',
  'migrations.ts',
  'profiles.ts',
  'schema.ts',
  'scrapingTasks.ts',
  'workflows.ts',
]

test('matches the owned top-level convex module cohort', () => {
  const root = new URL('../../convex/', import.meta.url)
  const actualModules = readdirSync(root)
    .filter((entry) => entry.endsWith('.ts'))
    .sort()

  expect(actualModules).toEqual(expectedModules)
})
