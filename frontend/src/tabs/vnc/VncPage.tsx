import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { ArrowLeft, FileText, LayoutGrid, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { VncTile, type DisplaySession } from './VncTile'
import { Button } from '@/components/ui/button'
import { buildVncWebSocketUrl } from '@/components/vnc-url'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { useIsMobile } from '@/hooks/use-mobile'
import { AmbientGlow } from '@/components/ui/ambient-glow'

const LogsViewer = lazy(() => import('@/components/LogsViewer').then((module) => ({ default: module.LogsViewer })))
const VncViewer = lazy(() => import('@/components/VncViewer').then((module) => ({ default: module.VncViewer })))

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
  const isMobile = useIsMobile()
  const isVisible = useDocumentVisibility()
  const [sessions, setSessions] = useState<DisplaySession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusedSessionKey, setFocusedSessionKey] = useState<string | null>(null)
  const [controlState, setControlState] = useState<'locked' | 'confirm' | 'unlocked'>('locked')
  const [showMobileLogs, setShowMobileLogs] = useState(false)

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

  const { connected } = useWebSocket({
    onEvent: handleSocketEvent,
    enabled: isVisible,
    pauseWhenHidden: true,
  })

  useEffect(() => {
    if (!isVisible) {
      return
    }

    void fetchSessions()

    if (connected) {
      return
    }

    const interval = setInterval(() => {
      void fetchSessions()
    }, isMobile ? 15000 : 5000)

    return () => clearInterval(interval)
  }, [connected, fetchSessions, isMobile, isVisible])

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

  useEffect(() => {
    setShowMobileLogs(false)
  }, [focusedSessionKey])

  const isInteractive = controlState === 'unlocked'
  const isConfirming = controlState === 'confirm'

  if (focusedSession) {
    if (isMobile) {
      return (
        <div className="flex flex-col h-full bg-[#050505] overflow-auto font-sans relative">
          <AmbientGlow className="w-[700px] h-[360px]" reducedClassName="w-[480px] h-[220px]" />
          <div className="mobile-effect-blur flex items-center justify-between px-3 py-2 bg-white/[0.02] border-b border-white/5 shrink-0 select-none shadow-xs z-10">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFocusedSessionKey(null)
                  setControlState('locked')
                }}
                className="h-8 shadow-none bg-transparent border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
              >
                <ArrowLeft className="mr-2 h-3.5 w-3.5" />
                Back
              </Button>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold uppercase tracking-wider bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                  {focusedSession.profileName}
                </h2>
                <span className="text-[10px] text-gray-500 font-mono">
                  {focusedSession.workflowId} / :{focusedSession.displayNum}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMobileLogs((current) => !current)}
              className="h-8 shadow-none bg-transparent border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
            >
              <FileText className="h-3.5 w-3.5" />
              {showMobileLogs ? 'Hide Logs' : 'Show Logs'}
            </Button>
          </div>

          <div className="flex-1 min-h-0 p-2 space-y-2">
            <div className="h-[50vh] min-h-[320px] rounded-[4px] overflow-hidden border border-white/[0.05] bg-black">
              <Suspense fallback={<div className="h-full w-full animate-pulse bg-black/60" />}>
                <VncViewer
                  url={buildVncWebSocketUrl(focusedSession.vncPort)}
                  interactive={isInteractive}
                  className="flex-1 w-full h-full object-contain"
                />
              </Suspense>
            </div>

            {!isInteractive ? (
              <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-3">
                <p className="text-xs text-gray-400 mb-3">Taking control will interrupt the agent.</p>
                <div className="flex gap-2">
                  {isConfirming ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => setControlState('locked')}
                        className="flex-1 bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => setControlState('unlocked')}
                        className="mobile-effect-shadow flex-1 border-none bg-gradient-to-r from-red-600 to-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-orange-500 transition-all font-medium"
                      >
                        Confirm
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setControlState('confirm')}
                      className="w-full bg-black/50 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none"
                    >
                      Take Control
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setControlState('locked')}
                className="bg-black/80 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none"
              >
                Return To Agent
              </Button>
            )}

            {showMobileLogs ? (
              <div className="h-[42vh] min-h-[260px] rounded-[4px] overflow-hidden border border-white/[0.05] bg-[#050505]">
                <Suspense fallback={<div className="h-full w-full animate-pulse bg-black/40" />}>
                  <LogsViewer
                    className="h-full border-0"
                    workflowId={focusedSession.workflowId === 'manual' ? null : focusedSession.workflowId}
                    profileName={focusedSession.profileName}
                  />
                </Suspense>
              </div>
            ) : null}
          </div>
        </div>
      )
    }

    return (
      <div className="flex flex-col h-full bg-[#050505] overflow-hidden font-sans relative">
        <AmbientGlow className="w-[800px] h-[400px]" reducedClassName="w-[560px] h-[240px]" />
        <div className="mobile-effect-blur flex items-center justify-between px-3 py-1.5 bg-white/[0.02] border-b border-white/5 backdrop-blur-xs shrink-0 select-none shadow-xs z-10">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFocusedSessionKey(null)
                setControlState('locked')
              }}
              className="h-8 shadow-none bg-transparent border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
            >
              <ArrowLeft className="mr-2 h-3.5 w-3.5" />
              Back to Grid
            </Button>
            <div className="flex items-baseline gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                {focusedSession.profileName}
              </h2>
              <span className="text-[10px] text-gray-500 font-mono">
                {focusedSession.workflowId} / :{focusedSession.displayNum}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchSessions()}
            className="h-8 shadow-none bg-transparent border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
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
              <div className="flex flex-col h-full bg-[#050505] border border-white/[0.05] rounded-[3px] shadow-xs relative overflow-hidden group">
                <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-black/80 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center px-2 pointer-events-none">
                  <div className="text-[10px] text-gray-400 font-mono tracking-widest uppercase">
                    Display Stream :{focusedSession.displayNum}
                  </div>
                </div>

                <Suspense fallback={<div className="h-full w-full animate-pulse bg-black/60" />}>
                  <VncViewer
                    url={buildVncWebSocketUrl(focusedSession.vncPort)}
                    interactive={isInteractive}
                    className="flex-1 w-full h-full object-contain"
                  />
                </Suspense>

                {!isInteractive && (
                  <div
                    className={`absolute inset-0 z-20 flex items-center justify-center transition-colors ${isConfirming ? 'bg-black/50 backdrop-blur-xs pointer-events-auto' : 'bg-black/0 group-hover:bg-black/25 pointer-events-none'}`}
                  >
                    <div className={`${isConfirming ? 'w-full max-w-[360px] mx-4' : ''}`}>
                      <div
                        className={`bg-[#0a0a0a] border border-white/10 rounded-lg shadow-lg overflow-hidden sm:rounded-lg ${isConfirming ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 pointer-events-auto transition-opacity'}`}
                      >
                        {isConfirming && (
                          <div className="flex flex-col space-y-1.5 text-center sm:text-left px-6 py-4">
                            <h2 className="text-lg font-semibold leading-none tracking-tight bg-gradient-to-r from-red-500 to-orange-400 bg-clip-text text-transparent">
                              Control Handoff
                            </h2>
                            <p className="text-sm text-gray-500">
                              Taking control will interrupt the agent.
                            </p>
                          </div>
                        )}
                        <div className={`flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 px-6 ${isConfirming ? 'pb-6 pt-2' : 'py-6'}`}>
                          {isConfirming ? (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => setControlState('locked')}
                                className="mt-2 sm:mt-0 bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none"
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={() => setControlState('unlocked')}
                                className="border-none bg-gradient-to-r from-red-600 to-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-orange-500 transition-all font-medium"
                              >
                                Confirm
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              onClick={() => setControlState('confirm')}
                              className="bg-black/50 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none backdrop-blur-xs"
                            >
                              Take Control
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {isInteractive && (
                  <div className="absolute bottom-4 right-4 z-20">
                    <Button
                      variant="outline"
                      onClick={() => setControlState('locked')}
                      className="bg-black/80 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none backdrop-blur-md"
                    >
                      Return To Agent
                    </Button>
                  </div>
                )}
              </div>
            </Panel>

            <Separator className="w-2 relative mx-0.5 flex items-center justify-center transition-colors hover:bg-white/5 rounded-sm group focus:outline-hidden focus:ring-0 active:outline-hidden">
              <div className="w-1 h-8 bg-white/10 rounded-full group-hover:bg-white/30 transition-colors" />
            </Separator>

            <Panel id="right-logs" defaultSize={40} minSize={20}>
              <div className="flex flex-col h-full rounded-[3px] overflow-hidden shadow-xs">
                <Suspense fallback={<div className="h-full w-full animate-pulse bg-black/40" />}>
                  <LogsViewer
                    className="h-full border-0"
                    workflowId={focusedSession.workflowId === 'manual' ? null : focusedSession.workflowId}
                    profileName={focusedSession.profileName}
                  />
                </Suspense>
              </div>
            </Panel>
          </Group>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#050505] overflow-hidden font-sans relative">
      <AmbientGlow className="w-[800px] h-[400px] bg-red-600/5" reducedClassName="w-[560px] h-[240px]" />
      <div className="mobile-effect-blur flex items-center justify-between px-3 py-1.5 bg-white/[0.02] border-b border-white/5 backdrop-blur-xs shrink-0 select-none shadow-xs z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Active Sessions
            </h2>
            <span className="text-[10px] text-gray-500 font-mono">
              [{sessions.length} live]
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-400">
            <span
              className={`w-2 h-2 rounded-full ${connected
                ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]'
                }`}
            />
            <span className={connected ? 'text-green-400' : 'text-red-400'}>
              {connected ? 'ws connected' : 'ws reconnecting'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchSessions()}
              className="h-8 shadow-none bg-transparent border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-2 overflow-auto z-10">
        {error ? (
          <div className="mb-2 rounded-[3px] border border-red-500/20 bg-red-500/10 text-red-400 px-3 py-2 text-xs">
            Failed to load displays: {error}
          </div>
        ) : null}

        {sessions.length === 0 ? (
          <div className="h-full min-h-[260px] border border-white/10 rounded-[4px] bg-white/[0.02] flex flex-col items-center justify-center gap-2 text-gray-500 backdrop-blur-xs">
            <LayoutGrid className="h-6 w-6" />
            <p className="text-xs font-medium">No active sessions</p>
            <p className="text-[11px]">Start a workflow to see browser displays.</p>
          </div>
        ) : (
          <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-[repeat(auto-fill,minmax(400px,1fr))]'}`}>
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
