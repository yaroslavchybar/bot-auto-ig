import { errors } from 'playwright-core'
import { isTransientDomIssue } from '../../shared/domErrors.js'

/** Optional UI work may retry navigation, timeouts and re-renders, but not browser or account failures. */
export function isTemporaryUiError(error: unknown): boolean {
  return error instanceof errors.TimeoutError || isTransientDomIssue(error) ||
    (error instanceof Error && error.message.includes('Execution context was destroyed, most likely because of a navigation'))
}
