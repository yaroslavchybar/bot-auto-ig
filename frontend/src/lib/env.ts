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

const disableAuth =
  import.meta.env.DEV && import.meta.env.DISABLE_AUTH === 'true'

function getServiceUrl(name: 'VITE_API_URL', devDefault: string): string {
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

const convexUrl = normalizeHttpsUrl(getRequiredEnv('VITE_CONVEX_URL'))

export const env = {
  apiUrl,
  convexUrl,
  disableAuth,
  isDev: import.meta.env.DEV,
} as const


