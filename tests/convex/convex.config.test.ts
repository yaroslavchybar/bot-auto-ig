import { beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

test('registers the crons component in the Convex app definition', async () => {
  const use = vi.fn()
  const cronsComponent = { name: 'crons-component' }

  vi.doMock('convex/server', () => ({
    defineApp: () => ({ use }),
  }))
  vi.doMock('@convex-dev/crons/convex.config.js', () => ({
    default: cronsComponent,
  }))

  const { default: app } = await import('../../convex/convex.config')

  expect(app).toBeDefined()
  expect(use).toHaveBeenCalledWith(cronsComponent)
})
