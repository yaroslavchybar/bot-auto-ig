import { expect, test } from 'vitest'

import { modules } from './helpers'

test('tracks the full owned convex module cohort', () => {
  const ownedModules = Object.keys(modules)
    .filter((path) => !path.includes('_generated'))
    .sort()

  expect(ownedModules).toEqual([
    '../convex.config.ts',
    '../crons.ts',
    '../dashboard.ts',
    '../http.ts',
    '../instagramAccounts.ts',
    '../keywords.ts',
    '../lists.ts',
    '../messageTemplates.ts',
    '../migrations.ts',
    '../profiles.ts',
    '../schema.ts',
    '../scrapingTasks.ts',
    '../workflows.ts',
  ])
})
