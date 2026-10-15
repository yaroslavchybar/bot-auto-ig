export type SessionDecision =
  | { kind: 'interest'; status: 'checking' | 'unavailable' }
  | { kind: 'interest'; status: 'complete'; confidence: number; related: boolean }
  | { kind: 'profile'; status: 'checking' | 'unavailable'; username: string }
  | { kind: 'profile'; status: 'complete'; username: string; category: 'male' | 'female' | 'business'; confidence: number }

/** Validate the small public payload; screenshots and prompts never enter the event stream. */
export function isSessionDecision(value: unknown): value is SessionDecision {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (item.kind !== 'interest' && item.kind !== 'profile') return false
  if (item.kind === 'profile' && (typeof item.username !== 'string' || !/^[\w.]{1,30}$/.test(item.username))) return false
  if (item.status === 'checking' || item.status === 'unavailable') return true
  if (item.status !== 'complete' || typeof item.confidence !== 'number' || !Number.isFinite(item.confidence)
    || item.confidence < 0 || item.confidence > 1) return false
  return item.kind === 'interest' ? typeof item.related === 'boolean'
    : ['male', 'female', 'business'].includes(String(item.category))
}
