import type { AuthConfig } from 'convex/server'

function normalizeDomain(value: string) {
  const trimmed = value.trim().replace(/\/$/, '')
  if (!trimmed) {
    throw new Error('CLERK_JWT_ISSUER_DOMAIN is empty.')
  }

  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

function getConfiguredIssuerDomain() {
  const issuerDomain = (globalThis as any)?.process?.env?.CLERK_JWT_ISSUER_DOMAIN
  return issuerDomain ? normalizeDomain(String(issuerDomain)) : null
}

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
  const frontendApi = decoded.endsWith('$') ? decoded.slice(0, -1) : decoded
  return normalizeDomain(frontendApi)
}

const clerkDomain = getConfiguredIssuerDomain() ?? getClerkDomainFromPublishableKey(getRequiredPublishableKey())

export default {
  providers: [
    {
      domain: clerkDomain,
      applicationID: 'convex',
    },
  ],
} satisfies AuthConfig
