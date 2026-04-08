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
    '../../convex/httpRoutes/instagramAccounts.ts',
    '../../convex/httpRoutes/keywords.ts',
    '../../convex/httpRoutes/lists.ts',
    '../../convex/httpRoutes/messageTemplates.ts',
    '../../convex/httpRoutes/profiles.ts',
    '../../convex/httpRoutes/scrapingAccounts.ts',
    '../../convex/httpRoutes/shared.ts',
    '../../convex/httpRoutes/workflowArtifacts.ts',
    '../../convex/httpRoutes/workflows.ts',
    '../../convex/instagramAccounts.ts',
    '../../convex/keywords.ts',
    '../../convex/lists.ts',
    '../../convex/messageTemplates.ts',
    '../../convex/profiles/helpers.ts',
    '../../convex/profiles/mutations.ts',
    '../../convex/profiles/queries.ts',
    '../../convex/profiles/scraping.ts',
    '../../convex/schema.ts',
    '../../convex/scrapingAccounts.ts',
    '../../convex/workflowArtifacts.ts',
    '../../convex/workflows/helpers.ts',
    '../../convex/workflows/mutations.ts',
    '../../convex/workflows/queries.ts',
    '../../convex/workflows/scheduling.ts',
  ])
})
