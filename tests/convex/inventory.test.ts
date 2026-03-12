import { expect, test } from 'vitest'

import { modules } from './helpers'

test('tracks the full owned convex module cohort', () => {
  const ownedModules = Object.keys(modules)
    .filter((path) => !path.includes('_generated'))
    .sort()

  expect(ownedModules).toEqual([
    '../../convex/auth.config.ts',
    '../../convex/auth.ts',
    '../../convex/convex.config.ts',
    '../../convex/crons.ts',
    '../../convex/http.ts',
    '../../convex/httpApi.ts',
    '../../convex/instagramAccounts.ts',
    '../../convex/keywords.ts',
    '../../convex/lists.ts',
    '../../convex/messageTemplates.ts',
    '../../convex/profiles.ts',
    '../../convex/schema.ts',
    '../../convex/workflowArtifacts.ts',
    '../../convex/workflows.ts',
  ])
})
