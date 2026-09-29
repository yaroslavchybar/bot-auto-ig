import { afterEach, beforeEach, vi } from 'vite-plus/test'

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
