import {
  isSessionDecision,
  type SessionDecision,
} from '../../../../../server/shared/sessionDecision'

export type DisplaySession = {
  id?: string
  decision?: SessionDecision | null
  automationId: string
  profileName: string
  vncPort: number
  displayNum: number
  status: 'active'
}

type DisplayEvent = {
  id?: unknown
  displayId?: unknown
  decision?: unknown
  type?: unknown
  status?: unknown
  automationId?: unknown
  profileName?: unknown
  profile?: unknown
  vncPort?: unknown
  displayNum?: unknown
}

export function sessionKey(session: DisplaySession): string {
  return `${session.automationId}:${session.profileName}`
}

export function buildVncSessionPath(session: {
  automationId: string
  profileName: string
}): string {
  return `/vnc/session/${encodeURIComponent(session.automationId)}/${encodeURIComponent(session.profileName)}`
}

export function decodeRouteParam(value: string | undefined): string {
  if (!value) return ''

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getEventAutomationId(event: DisplayEvent): string {
  return String(event?.automationId ?? '').trim()
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeSessions(input: unknown): DisplaySession[] {
  if (!Array.isArray(input)) return []

  const out: DisplaySession[] = []
  const seen = new Set<string>()

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue

    const item = raw as DisplayEvent
    const automationId = getEventAutomationId(item)
    const profileName = String(item.profileName ?? '').trim()
    const vncPort = toNumber(item.vncPort)
    const displayNum = toNumber(item.displayNum)

    if (!automationId || !profileName || vncPort === null || displayNum === null) continue

    const session: DisplaySession = {
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      automationId,
      profileName,
      vncPort,
      displayNum,
      status: 'active',
    }

    const key = sessionKey(session)
    if (seen.has(key)) continue

    seen.add(key)
    out.push(session)
  }

  out.sort((a, b) => {
    if (a.automationId !== b.automationId) {
      return a.automationId.localeCompare(b.automationId)
    }

    return a.profileName.localeCompare(b.profileName)
  })

  return out
}

/** Periodic display snapshots must not erase a newer decision from the same lease. */
export function mergeSessionSnapshot(
  current: DisplaySession[],
  incoming: unknown,
): DisplaySession[] {
  return normalizeSessions(incoming).map((session) => {
    const previous =
      session.id &&
      current.find((item) => item.id === session.id && sessionKey(item) === sessionKey(session))
    return previous ? { ...session, decision: previous.decision } : session
  })
}

export function applyDisplayEvent(sessions: DisplaySession[], event: unknown): DisplaySession[] {
  if (!event || typeof event !== 'object') return sessions

  const item = event as DisplayEvent
  const eventType = String(item.type || '')
  const automationId = getEventAutomationId(item)
  const profileName = String(item.profileName ?? '').trim()

  if (eventType === 'session_decision') {
    if (
      typeof item.displayId !== 'string' ||
      (item.decision !== null && !isSessionDecision(item.decision))
    )
      return sessions
    const decision = item.decision as SessionDecision | null
    return sessions.map((session) =>
      session.id === item.displayId &&
      session.automationId === automationId &&
      session.profileName === profileName
        ? { ...session, decision }
        : session,
    )
  }

  if (eventType === 'display_allocated') {
    const vncPort = toNumber(item.vncPort)
    const displayNum = toNumber(item.displayNum)

    if (!automationId || !profileName || vncPort === null || displayNum === null) {
      return sessions
    }

    const nextSession: DisplaySession = {
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      automationId,
      profileName,
      vncPort,
      displayNum,
      status: 'active',
    }
    const key = sessionKey(nextSession)

    return [...sessions.filter((session) => sessionKey(session) !== key), nextSession].sort(
      (a, b) => {
        if (a.automationId !== b.automationId) {
          return a.automationId.localeCompare(b.automationId)
        }

        return a.profileName.localeCompare(b.profileName)
      },
    )
  }

  if (eventType === 'display_released' || eventType === 'profile_completed') {
    if (!automationId || !profileName) return sessions

    return sessions.filter((session) => sessionKey(session) !== `${automationId}:${profileName}`)
  }

  if (eventType === 'automation_status' && automationId && String(item.status || '') === 'idle') {
    return sessions.filter((session) => session.automationId !== automationId)
  }

  return sessions
}
