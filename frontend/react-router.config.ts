import type { Config } from '@react-router/dev/config'
import { sentryOnBuildEnd } from '@sentry/react-router'

export default {
  appDirectory: 'src',
  future: {
    v8_middleware: true,
  },
  ssr: true,
  buildEnd: async ({ viteConfig, reactRouterConfig, buildManifest }) => {
    if (process.env.SENTRY_AUTH_TOKEN) {
      await sentryOnBuildEnd({
        viteConfig,
        reactRouterConfig,
        buildManifest,
      })
    }
  },
} satisfies Config
