import { test, expect } from 'bun:test'
import { allocateContent, availableSources } from './content.js'

test('browser content calls reach the authenticated Rust owner with exclusions', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async (url, options) => {
    expect(String(url)).toMatch(/\/content\/(allocate|available)$/)
    expect(new Headers(options?.headers).get('authorization')).toStartWith('Bearer ')
    expect(JSON.parse(String(options?.body))).toEqual({
      modelId: 'model-1',
      kind: 'posts',
      profileId: 'p',
      excludeIds: ['used'],
    })
    return Response.json(
      String(url).endsWith('allocate') ? { sourceId: 's', path: '/image.jpg' } : 2,
    )
  }) as typeof fetch
  try {
    expect(await allocateContent('model-1', 'posts', 'p', ['used'])).toEqual({
      sourceId: 's',
      path: '/image.jpg',
    })
    expect(await availableSources('model-1', 'posts', 'p', ['used'])).toBe(2)
  } finally {
    globalThis.fetch = original
  }
})
