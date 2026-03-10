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

function getServiceUrl(
  name: 'VITE_API_URL' | 'VITE_DATAUPLOADER_URL',
  devDefault: string,
  prodDefault: string,
): string {
  const value = import.meta.env[name]

  if (typeof value === 'string') {
    return trimTrailingSlash(value)
  }

  if (import.meta.env.PROD) {
    return trimTrailingSlash(prodDefault)
  }

  return devDefault
}

const apiUrl = getServiceUrl('VITE_API_URL', 'http://localhost:3001', '')

const dataUploaderUrl = getServiceUrl(
  'VITE_DATAUPLOADER_URL',
  'http://localhost:3002',
  '/api/datauploader',
)

const convexUrl = normalizeHttpsUrl(getRequiredEnv('VITE_CONVEX_URL'))

export const env = {
  apiUrl,
  clerkPublishableKey: getRequiredEnv('VITE_CLERK_PUBLISHABLE_KEY'),
  convexUrl,
  dataUploaderUrl,
  isDev: import.meta.env.DEV,
} as const


