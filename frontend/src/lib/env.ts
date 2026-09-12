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

type RequiredEnvName = 'VITE_CONVEX_URL'

function getRequiredEnv(name: RequiredEnvName): string {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(`Missing ${name} environment variable`)
  }

  return value
}

const disableClerkAuth =
  import.meta.env.DEV && import.meta.env.DISABLE_CLERK_AUTH === 'true'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!disableClerkAuth && !clerkPublishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable')
}

function getServiceUrl(
  name: 'VITE_API_URL' | 'VITE_DATAUPLOADER_URL',
  devDefault: string,
): string {
  const value = import.meta.env[name]
  if (value) {
    return trimTrailingSlash(value)
  }

  if (import.meta.env.PROD) {
    throw new Error(`Missing ${name} environment variable for production build`)
  }

  return devDefault
}

const apiUrl = getServiceUrl('VITE_API_URL', 'http://localhost:3001')

const dataUploaderUrl = getServiceUrl(
  'VITE_DATAUPLOADER_URL',
  'http://localhost:3002',
)

const convexUrl = normalizeHttpsUrl(getRequiredEnv('VITE_CONVEX_URL'))

export const env = {
  apiUrl,
  clerkPublishableKey,
  convexUrl,
  dataUploaderUrl,
  disableClerkAuth,
  isDev: import.meta.env.DEV,
} as const


