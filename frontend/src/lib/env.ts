function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

function normalizeHttpsUrl(value: string): string {
  const trimmed = trimTrailingSlash(value.trim())
  if (/^https?:\/\//.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}

type RequiredEnvName = 'VITE_CLERK_PUBLISHABLE_KEY' | 'VITE_CONVEX_URL'

function getRequiredEnv(name: RequiredEnvName): string {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(`Missing ${name} environment variable`)
  }

  return value
}

const apiUrl = import.meta.env.VITE_API_URL
  ? trimTrailingSlash(import.meta.env.VITE_API_URL)
  : 'http://localhost:3001'

const dataUploaderUrl = import.meta.env.VITE_DATAUPLOADER_URL
  ? trimTrailingSlash(import.meta.env.VITE_DATAUPLOADER_URL)
  : import.meta.env.DEV
    ? 'http://localhost:3002'
    : '/api/datauploader'

const convexUrl = normalizeHttpsUrl(getRequiredEnv('VITE_CONVEX_URL'))

export const env = {
  apiUrl,
  clerkPublishableKey: getRequiredEnv('VITE_CLERK_PUBLISHABLE_KEY'),
  convexApiKey: import.meta.env.VITE_CONVEX_API_KEY ?? '',
  convexSiteUrl: convexUrl.replace('.convex.cloud', '.convex.site'),
  convexUrl,
  dataUploaderUrl,
  isDev: import.meta.env.DEV,
} as const
