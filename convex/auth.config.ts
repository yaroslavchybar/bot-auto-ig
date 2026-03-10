import type { AuthConfig } from 'convex/server'

function getRequiredPublishableKey() {
  const publishableKey =
    (globalThis as any)?.process?.env?.CLERK_PUBLISHABLE_KEY ||
    (globalThis as any)?.process?.env?.VITE_CLERK_PUBLISHABLE_KEY

  if (!publishableKey) {
    throw new Error(
      'Missing Clerk publishable key. Set CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY.',
    )
  }

  return String(publishableKey)
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')

  if (typeof atob === 'function') {
    return atob(padded)
  }

  const runtimeBuffer = (globalThis as { Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } } }).Buffer
  if (runtimeBuffer) {
    return runtimeBuffer.from(padded, 'base64').toString('utf8')
  }

  throw new Error('No base64 decoder available in Convex auth config runtime.')
}

function getClerkDomainFromPublishableKey(publishableKey: string) {
  const encodedFrontendApi = publishableKey.split('_')[2]

  if (!encodedFrontendApi) {
    throw new Error('Invalid Clerk publishable key format.')
  }

  const decoded = decodeBase64Url(encodedFrontendApi)

  if (!decoded.endsWith('$')) {
    throw new Error('Invalid Clerk publishable key payload.')
  }

  const frontendApi = decoded.slice(0, -1)
  return frontendApi.startsWith('http') ? frontendApi : `https://${frontendApi}`
}

const publishableKey = getRequiredPublishableKey()

export default {
  providers: [
    {
      domain: getClerkDomainFromPublishableKey(publishableKey),
      applicationID: 'convex',
    },
  ],
} satisfies AuthConfig
