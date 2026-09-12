/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly DISABLE_AUTH?: string
  readonly VITE_API_URL?: string
  readonly VITE_CONVEX_URL: string
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}


