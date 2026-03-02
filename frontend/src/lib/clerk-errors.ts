type ClerkErrorItem = {
  longMessage?: string
  message?: string
}

type ClerkErrorPayload = {
  errors: ClerkErrorItem[]
}

function isClerkErrorPayload(value: unknown): value is ClerkErrorPayload {
  if (typeof value !== 'object' || value === null) return false
  if (!('errors' in value)) return false
  const maybeErrors = (value as { errors?: unknown }).errors
  return Array.isArray(maybeErrors)
}

export function getClerkErrorMessage(error: unknown, fallback = 'Authentication request failed.'): string {
  if (isClerkErrorPayload(error)) {
    for (const issue of error.errors) {
      if (issue.longMessage) return issue.longMessage
      if (issue.message) return issue.message
    }
  }

  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return fallback
}
