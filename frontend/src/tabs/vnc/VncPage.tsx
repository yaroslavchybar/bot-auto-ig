import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { ArrowLeft, LayoutGrid, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { LogsViewer } from '@/components/LogsViewer'
import { VncViewer } from '@/components/VncViewer'
import { VncTile, type DisplaySession } from './VncTile'

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

function sessionKey(session: DisplaySession): string {
  return `${session.workflowId}:${session.profileName}`
}

function getEventWorkflowId(event: DisplayEvent): string {
  return String(event?.workflowId ?? event?.workflow_id ?? '').trim()
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSessions(input: unknown): DisplaySession[] {
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
    if (!workflowId || !profileName || vncPort === null || displayNum === null) continue
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
    if (a.workflowId !== b.workflowId) return a.workflowId.localeCompare(b.workflowId)
    return a.profileName.localeCompare(b.profileName)
  })
  return out
}

export function VncPage() {
  const [sessions, setSessions] = useState<DisplaySession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusedSessionKey, setFocusedSessionKey] = useState<string | null>(null)
  const [controlState, setControlState] = useState<'locked' | 'confirm' | 'unlocked'>('locked')

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<DisplaySession[]>('/api/displays')
      setSessions(normalizeSessions(data))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSocketEvent = useCallback((event: DisplayEvent) => {
    const eventType = String(event?.type || '')
    const workflowId = getEventWorkflowId(event)
    const profileName = String(event?.profileName ?? event?.profile ?? '').trim()

    if (eventType === 'display_allocated') {
      const vncPort = toNumber(event?.vncPort ?? event?.vnc_port)
      const displayNum = toNumber(event?.displayNum ?? event?.display_num)
      if (!workflowId || !profileName || vncPort === null || displayNum === null) return

      const nextSession: DisplaySession = {
        workflowId,
        profileName,
        vncPort,
        displayNum,
        status: 'active',
      }
      setSessions((prev) => {
        const key = sessionKey(nextSession)
        const filtered = prev.filter((item) => sessionKey(item) !== key)
        return [...filtered, nextSession].sort((a, b) => {
          if (a.workflowId !== b.workflowId) return a.workflowId.localeCompare(b.workflowId)
          return a.profileName.localeCompare(b.profileName)
        })
      })
      return
    }

    if (eventType === 'display_released' || eventType === 'profile_completed') {
      if (!workflowId || !profileName) return
      setSessions((prev) => prev.filter((item) => sessionKey(item) !== `${workflowId}:${profileName}`))
      return
    }

    if (eventType === 'workflow_status') {
      const status = String(event?.status || '')
      if (workflowId && status === 'idle') {
        setSessions((prev) => prev.filter((item) => item.workflowId !== workflowId))
      }
    }
  }, [])

  const { connected } = useWebSocket({ onEvent: handleSocketEvent })

  useEffect(() => {
    void fetchSessions()
    const interval = setInterval(() => {
      void fetchSessions()
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  const focusedSession = useMemo(
    () => sessions.find((item) => sessionKey(item) === focusedSessionKey) ?? null,
    [sessions, focusedSessionKey]
  )

  useEffect(() => {
    if (focusedSessionKey && !focusedSession) {
      setFocusedSessionKey(null)
      setControlState('locked')
    }
  }, [focusedSessionKey, focusedSession])

  const getVncUrl = (vncPort: number) => {
    if (typeof window === 'undefined') return `http://localhost:${vncPort}/vnc.html`
    return `${window.location.protocol}//${window.location.hostname}:${vncPort}/vnc.html`
  }

  const isInteractive = controlState === 'unlocked'
  const isConfirming = controlState === 'confirm'

  if (focusedSession) {
    return (
      <div className="flex flex-col h-full bg-neutral-200 dark:bg-neutral-900 overflow-hidden font-sans">
        <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 shrink-0 select-none shadow-sm z-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setFocusedSessionKey(null)
                setControlState('locked')
              }}
              className="h-7 px-2.5 text-[11px] rounded-[3px] border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Grid
            </button>
            <div className="flex items-baseline gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
                {focusedSession.profileName}
              </h2>
              <span className="text-[10px] text-neutral-500 font-mono">
                {focusedSession.workflowId} / :{focusedSession.displayNum}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void fetchSessions()}
            className="h-7 px-2.5 text-[11px] rounded-[3px] border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="flex-1 min-h-0 p-1">
          <Group
            orientation="horizontal"
            id="vnc-focus-layout-group"
            onLayoutChanged={(layout) => {
              localStorage.setItem('vnc-focus-layout-sizes', JSON.stringify(layout))
            }}
            defaultLayout={(() => {
              try {
                const stored = localStorage.getItem('vnc-focus-layout-sizes')
                return stored ? JSON.parse(stored) : undefined
              } catch {
                return undefined
              }
            })()}
          >
            <Panel id="left-vnc" defaultSize={60} minSize={30}>
              <div className="flex flex-col h-full bg-black border border-neutral-300 dark:border-neutral-700 rounded-[3px] shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-black/80 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center px-2 pointer-events-none">
                  <div className="text-[10px] text-white/70 font-mono tracking-widest uppercase">
                    Display Stream :{focusedSession.displayNum}
                  </div>
                </div>

                <VncViewer url={getVncUrl(focusedSession.vncPort)} interactive={isInteractive} className="flex-1 w-full h-full object-contain" />

                {!isInteractive && (
                  <div
                    className={`absolute inset-0 z-20 flex items-center justify-center transition-colors ${isConfirming ? 'bg-black/35 pointer-events-auto' : 'bg-black/0 group-hover:bg-black/25 pointer-events-none'}`}
                  >
                    <div className={`${isConfirming ? 'w-full max-w-[360px] mx-4' : ''}`}>
                      <div
                        className={`bg-neutral-100/95 dark:bg-neutral-800/95 border border-neutral-300 dark:border-neutral-600 rounded-[3px] shadow-sm overflow-hidden ${isConfirming ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 pointer-events-auto transition-opacity'}`}
                      >
                        {isConfirming && (
                          <>
                            <div className="px-3 py-1 text-[10px] uppercase tracking-wider font-mono text-neutral-500 dark:text-neutral-400 bg-white/60 dark:bg-neutral-900/40 border-b border-neutral-300 dark:border-neutral-700">
                              Control Handoff
                            </div>
                            <div className="px-3 py-2.5 text-xs text-neutral-700 dark:text-neutral-200">
                              Taking control will interrupt the agent.
                            </div>
                          </>
                        )}
                        <div className={`px-3 ${isConfirming ? 'pb-3 flex items-center justify-end gap-1.5' : 'py-3'}`}>
                          {isConfirming ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setControlState('locked')}
                                className="h-6 px-2.5 text-[11px] rounded-[3px] border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => setControlState('unlocked')}
                                className="h-6 px-2.5 text-[11px] rounded-[3px] border border-red-600/70 dark:border-red-500/70 bg-red-600 text-white hover:bg-red-700 transition-colors"
                              >
                                Confirm
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setControlState('confirm')}
                              className="h-7 px-3 text-[11px] rounded-[3px] border border-neutral-300 dark:border-neutral-600 font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                            >
                              Take Control
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {isInteractive && (
                  <div className="absolute bottom-2 right-2 z-20">
                    <button
                      type="button"
                      onClick={() => setControlState('locked')}
                      className="h-6 px-2.5 text-[11px] rounded-[3px] border border-neutral-300/70 dark:border-neutral-600/70 bg-neutral-100/90 dark:bg-neutral-800/90 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                    >
                      Return To Agent
                    </button>
                  </div>
                )}
              </div>
            </Panel>

            <Separator className="w-2 relative mx-0.5 flex items-center justify-center transition-colors hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50 rounded group focus:outline-none focus:ring-0 active:outline-none">
              <div className="w-1 h-8 bg-neutral-300 dark:bg-neutral-600 rounded-full group-hover:bg-neutral-400 dark:group-hover:bg-neutral-500 transition-colors" />
            </Separator>

            <Panel id="right-logs" defaultSize={40} minSize={20}>
              <div className="flex flex-col h-full rounded-[3px] overflow-hidden shadow-sm">
                <LogsViewer
                  className="h-full border-0"
                  workflowId={focusedSession.workflowId === 'manual' ? null : focusedSession.workflowId}
                  profileName={focusedSession.profileName}
                />
              </div>
            </Panel>
          </Group>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-neutral-200 dark:bg-neutral-900 overflow-hidden font-sans">
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 shrink-0 select-none shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
              Active Sessions
            </h2>
            <span className="text-[10px] text-neutral-500 font-mono">
              [{sessions.length} live]
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-500">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {connected ? 'ws connected' : 'ws reconnecting'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void fetchSessions()}
          className="h-7 px-2.5 text-[11px] rounded-[3px] border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors inline-flex items-center gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex-1 min-h-0 p-2 overflow-auto">
        {error ? (
          <div className="mb-2 rounded-[3px] border border-red-300 bg-red-100/70 dark:bg-red-950/40 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 text-xs">
            Failed to load displays: {error}
          </div>
        ) : null}

        {sessions.length === 0 ? (
          <div className="h-full min-h-[260px] border border-dashed border-neutral-400/70 dark:border-neutral-600 rounded-[4px] bg-neutral-100/60 dark:bg-neutral-800/40 flex flex-col items-center justify-center gap-2 text-neutral-500 dark:text-neutral-400">
            <LayoutGrid className="h-6 w-6" />
            <p className="text-xs font-medium">No active sessions</p>
            <p className="text-[11px]">Start a workflow to see browser displays.</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-2">
            {sessions.map((session) => (
              <VncTile
                key={sessionKey(session)}
                session={session}
                onSelect={() => {
                  setFocusedSessionKey(sessionKey(session))
                  setControlState('locked')
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
