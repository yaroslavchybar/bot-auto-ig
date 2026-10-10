import type { Doc } from './_generated/dataModel';

export const ROUTINE_RETRY_MS = 15 * 60_000;

function failureReason(issue: string | undefined): string {
  // Playwright appends destination URLs and call logs; they are not failure reasons.
  return issue?.split(/\r?\n/, 1)[0].replace(/https?:\/\/\S+/gi, '') ?? '';
}

export function isRoutineLoginIssue(issue: string | undefined): boolean {
  return /\b(?:login|challenge|checkpoint)\b/i.test(failureReason(issue));
}

/** Retry known transport/browser failures; account and delivery issues need review. */
export function isRetryableRoutineIssue(issue: string | undefined): boolean {
  const reason = failureReason(issue);
  if (!reason || isRoutineLoginIssue(reason) || /needs review|could not be confirmed/i.test(reason)) return false;
  const networkCode = reason.match(/net::(ERR_[A-Z_]+)/i)?.[1];
  if (networkCode) return /^(?:ERR_CONNECTION_(?:CLOSED|RESET|REFUSED|ABORTED|TIMED_OUT)|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED)$/i.test(networkCode);
  return /timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|failed to fetch|network error|connection reset/i.test(reason);
}

/** Saved transient issues use a deadline too, so existing profiles recover on deployment. */
export function routineRetryState(state: Pick<Doc<'accountProgress'>, 'issue' | 'nextRunAt' | 'updatedAt'> | null | undefined) {
  const retryable = isRetryableRoutineIssue(state?.issue);
  return {
    issue: retryable ? undefined : state?.issue,
    nextRunAt: retryable && state
      ? Math.max(state.nextRunAt, state.updatedAt + ROUTINE_RETRY_MS)
      : state?.nextRunAt ?? 0,
  };
}
