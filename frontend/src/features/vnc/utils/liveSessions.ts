export type DisplaySession = {
  automationId: string
  profileName: string
  vncPort: number
  displayNum: number
  status: 'active'
}

type DisplayEvent = {
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

    if (!automationId || !profileName || vncPort === null || displayNum === null)
      continue

    const session: DisplaySession = {
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

export function applyDisplayEvent(
  sessions: DisplaySession[],
  event: unknown,
): DisplaySession[] {
  if (!event || typeof event !== 'object') return sessions

  const item = event as DisplayEvent
  const eventType = String(item.type || '')
  const automationId = getEventAutomationId(item)
  const profileName = String(item.profileName ?? '').trim()

  if (eventType === 'display_allocated') {
    const vncPort = toNumber(item.vncPort)
    const displayNum = toNumber(item.displayNum)

    if (!automationId || !profileName || vncPort === null || displayNum === null) {
      return sessions
    }

    const nextSession: DisplaySession = {
      automationId,
      profileName,
      vncPort,
      displayNum,
      status: 'active',
    }
    const key = sessionKey(nextSession)

    return [...sessions.filter((session) => sessionKey(session) !== key), nextSession]
      .sort((a, b) => {
        if (a.automationId !== b.automationId) {
          return a.automationId.localeCompare(b.automationId)
        }

        return a.profileName.localeCompare(b.profileName)
      })
  }

  if (eventType === 'display_released' || eventType === 'profile_completed') {
    if (!automationId || !profileName) return sessions

    return sessions.filter(
      (session) => sessionKey(session) !== `${automationId}:${profileName}`,
    )
  }

  if (eventType === 'automation_status' && automationId && String(item.status || '') === 'idle') {
    return sessions.filter((session) => session.automationId !== automationId)
  }

  return sessions
}
