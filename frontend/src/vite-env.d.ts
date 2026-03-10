/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_CLERK_PUBLISHABLE_KEY: string
  readonly VITE_CONVEX_URL: string
  readonly VITE_DATAUPLOADER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}


