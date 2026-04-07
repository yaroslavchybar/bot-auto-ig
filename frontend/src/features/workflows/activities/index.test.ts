import { describe, expect, it } from 'vitest'

import { getDefaultConfig, normalizeActivityConfig } from './index'

describe('scrape_relationships activity config', () => {
  it('includes default scrape caps for new nodes', () => {
    expect(getDefaultConfig('scrape_relationships')).toMatchObject({
      kind: 'followers',
      targets: [],
      useAccountUsernames: false,
      chunkLimit: 200,
      followersMaxToScrape: 0,
      followingMaxToScrape: 0,
      maxPagesPerAttempt: 3,
      maxAttempts: 4,
      retryBackoffSeconds: '30,120,600,1800',
      openDelaySeconds: 2,
    })
  })

  it('preserves explicit scrape caps when loading saved workflows', () => {
    expect(
      normalizeActivityConfig('scrape_relationships', {
        kind: 'both',
        followersMaxToScrape: 125,
        followingMaxToScrape: 80,
      }),
    ).toMatchObject({
      kind: 'both',
      followersMaxToScrape: 125,
      followingMaxToScrape: 80,
    })
  })
})
