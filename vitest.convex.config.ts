import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['convex/tests/**/*.test.ts'],
    setupFiles: ['convex/tests/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
  server: {
    deps: {
      inline: ['convex-test'],
    },
  },
})
