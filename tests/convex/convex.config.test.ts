import { beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

test('defines a Convex app without extra components', async () => {
  const use = vi.fn()

  vi.doMock('convex/server', () => ({
    defineApp: () => ({ use }),
  }))

  const { default: app } = await import('../../convex/convex.config')

  expect(app).toBeDefined()
  expect(use).not.toHaveBeenCalled()
})
