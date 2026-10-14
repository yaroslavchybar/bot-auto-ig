import { errors } from 'playwright-core'
import { isTransientDomIssue } from '../../shared/domErrors.js'

/** Optional UI work may retry timeouts and re-renders, but not browser or account failures. */
export function isTemporaryUiError(error: unknown): boolean {
  return error instanceof errors.TimeoutError || isTransientDomIssue(error)
}
