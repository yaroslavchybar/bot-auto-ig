export type DisplaySession = {
  workflowId: string
  profileName: string
  vncPort: number
  displayNum: number
  status: 'active'
}

type DisplayEvent = {
  type?: unknown
  status?: unknown
  workflowId?: unknown
  workflow_id?: unknown
  profileName?: unknown
  profile?: unknown
  vncPort?: unknown
  vnc_port?: unknown
  displayNum?: unknown
  display_num?: unknown
}

export function sessionKey(session: DisplaySession): string {
  return `${session.workflowId}:${session.profileName}`
}

export function buildVncSessionPath(session: {
  workflowId: string
  profileName: string
}): string {
  return `/vnc/session/${encodeURIComponent(session.workflowId)}/${encodeURIComponent(session.profileName)}`
}

export function decodeRouteParam(value: string | undefined): string {
  if (!value) return ''

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getEventWorkflowId(event: DisplayEvent): string {
  return String(event?.workflowId ?? event?.workflow_id ?? '').trim()
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
    const workflowId = getEventWorkflowId(item)
    const profileName = String(item.profileName ?? item.profile ?? '').trim()
    const vncPort = toNumber(item.vncPort ?? item.vnc_port)
    const displayNum = toNumber(item.displayNum ?? item.display_num)

    if (!workflowId || !profileName || vncPort === null || displayNum === null)
      continue

    const session: DisplaySession = {
      workflowId,
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
    if (a.workflowId !== b.workflowId) {
      return a.workflowId.localeCompare(b.workflowId)
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
  const workflowId = getEventWorkflowId(item)
  const profileName = String(item.profileName ?? item.profile ?? '').trim()

  if (eventType === 'display_allocated') {
    const vncPort = toNumber(item.vncPort ?? item.vnc_port)
    const displayNum = toNumber(item.displayNum ?? item.display_num)

    if (!workflowId || !profileName || vncPort === null || displayNum === null) {
      return sessions
    }

    const nextSession: DisplaySession = {
      workflowId,
      profileName,
      vncPort,
      displayNum,
      status: 'active',
    }
    const key = sessionKey(nextSession)

    return [...sessions.filter((session) => sessionKey(session) !== key), nextSession]
      .sort((a, b) => {
        if (a.workflowId !== b.workflowId) {
          return a.workflowId.localeCompare(b.workflowId)
        }

        return a.profileName.localeCompare(b.profileName)
      })
  }

  if (eventType === 'display_released' || eventType === 'profile_completed') {
    if (!workflowId || !profileName) return sessions

    return sessions.filter(
      (session) => sessionKey(session) !== `${workflowId}:${profileName}`,
    )
  }

  if (eventType === 'workflow_status' && workflowId && String(item.status || '') === 'idle') {
    return sessions.filter((session) => session.workflowId !== workflowId)
  }

  return sessions
}
