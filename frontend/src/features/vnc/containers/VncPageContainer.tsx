import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { ArrowLeft, FileText, LayoutGrid, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { VncTile, type DisplaySession } from '../components/VncTile'
import { Button } from '@/components/ui/button'
import { buildVncWebSocketUrl } from '@/features/vnc/utils/buildVncWebSocketUrl'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { useIsMobile } from '@/hooks/use-mobile'
import { AmbientGlow } from '@/components/ui/ambient-glow'

const LogsViewer = lazy(() =>
  import('@/components/shared/LogsViewer').then((module) => ({
    default: module.LogsViewer,
  })),
)
const VncViewer = lazy(() =>
  import('@/features/vnc/components/VncViewer').then((module) => ({
    default: module.VncViewer,
  })),
)

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
    if (a.workflowId !== b.workflowId)
      return a.workflowId.localeCompare(b.workflowId)
    return a.profileName.localeCompare(b.profileName)
  })
  return out
}

export function VncPageContainer() {
  const isMobile = useIsMobile()
  const isVisible = useDocumentVisibility()
  const [sessions, setSessions] = useState<DisplaySession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusedSessionKey, setFocusedSessionKey] = useState<string | null>(
    null,
  )
  const [controlState, setControlState] = useState<
    'locked' | 'confirm' | 'unlocked'
  >('locked')
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
    const profileName = String(
      event?.profileName ?? event?.profile ?? '',
    ).trim()

    if (eventType === 'display_allocated') {
      const vncPort = toNumber(event?.vncPort ?? event?.vnc_port)
      const displayNum = toNumber(event?.displayNum ?? event?.display_num)
      if (
        !workflowId ||
        !profileName ||
        vncPort === null ||
        displayNum === null
      )
        return

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
          if (a.workflowId !== b.workflowId)
            return a.workflowId.localeCompare(b.workflowId)
          return a.profileName.localeCompare(b.profileName)
        })
      })
      return
    }

    if (eventType === 'display_released' || eventType === 'profile_completed') {
      if (!workflowId || !profileName) return
      setSessions((prev) =>
        prev.filter(
          (item) => sessionKey(item) !== `${workflowId}:${profileName}`,
        ),
      )
      return
    }

    if (eventType === 'workflow_status') {
      const status = String(event?.status || '')
      if (workflowId && status === 'idle') {
        setSessions((prev) =>
          prev.filter((item) => item.workflowId !== workflowId),
        )
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

    const interval = setInterval(
      () => {
        void fetchSessions()
      },
      isMobile ? 15000 : 5000,
    )

    return () => clearInterval(interval)
  }, [connected, fetchSessions, isMobile, isVisible])

  const focusedSession = useMemo(
    () =>
      sessions.find((item) => sessionKey(item) === focusedSessionKey) ?? null,
    [sessions, focusedSessionKey],
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
        <div className="bg-shell relative flex h-full flex-col overflow-auto font-sans">
          <AmbientGlow
            className="h-[360px] w-[700px]"
            reducedClassName="w-[480px] h-[220px]"
          />
          <div className="mobile-effect-blur bg-panel-subtle border-line-soft z-10 flex shrink-0 items-center justify-between border-b px-3 py-2 shadow-xs select-none">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFocusedSessionKey(null)
                  setControlState('locked')
                }}
                className="border-line text-copy hover:bg-panel-hover h-8 bg-transparent shadow-none transition-all hover:text-ink"
              >
                <ArrowLeft className="mr-2 h-3.5 w-3.5" />
                Back
              </Button>
              <div className="min-w-0">
                <h2 className="page-title-gradient truncate text-sm font-bold tracking-wider uppercase">
                  {focusedSession.profileName}
                </h2>
                <span className="text-subtle-copy font-mono text-[10px]">
                  {focusedSession.workflowId} / :{focusedSession.displayNum}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMobileLogs((current) => !current)}
              className="border-line text-copy hover:bg-panel-hover h-8 bg-transparent shadow-none transition-all hover:text-ink"
            >
              <FileText className="h-3.5 w-3.5" />
              {showMobileLogs ? 'Hide Logs' : 'Show Logs'}
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 p-2">
            <div className="border-line-soft h-[50vh] min-h-[320px] overflow-hidden rounded-[4px] border bg-black">
              <Suspense
                fallback={
                  <div className="bg-overlay h-full w-full animate-pulse" />
                }
              >
                <VncViewer
                  url={buildVncWebSocketUrl(focusedSession.vncPort)}
                  interactive={isInteractive}
                  className="h-full w-full flex-1 object-contain"
                />
              </Suspense>
            </div>

            {!isInteractive ? (
              <div className="border-line bg-panel rounded-xl border p-3">
                <p className="text-muted-copy mb-3 text-xs">
                  Taking control will interrupt the agent.
                </p>
                <div className="flex gap-2">
                  {isConfirming ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => setControlState('locked')}
                        className="border-line text-copy hover:bg-panel-hover flex-1 border bg-transparent shadow-none transition-all hover:text-ink"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => setControlState('unlocked')}
                        className="mobile-effect-shadow brand-button flex-1 font-medium"
                      >
                        Confirm
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setControlState('confirm')}
                      className="bg-field border-line text-copy hover:bg-panel-hover w-full border shadow-none transition-all hover:text-ink"
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
                className="bg-overlay-strong border-line text-copy hover:bg-panel-hover border shadow-none transition-all hover:text-ink"
              >
                Return To Agent
              </Button>
            )}

            {showMobileLogs ? (
              <div className="border-line-soft bg-shell h-[42vh] min-h-[260px] overflow-hidden rounded-[4px] border">
                <Suspense
                  fallback={
                    <div className="bg-field-alt h-full w-full animate-pulse" />
                  }
                >
                  <LogsViewer
                    className="h-full border-0"
                    workflowId={
                      focusedSession.workflowId === 'manual'
                        ? null
                        : focusedSession.workflowId
                    }
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
      <div className="bg-shell relative flex h-full flex-col overflow-hidden font-sans">
        <AmbientGlow
          className="h-[400px] w-[800px]"
          reducedClassName="w-[560px] h-[240px]"
        />
        <div className="mobile-effect-blur bg-panel-subtle border-line-soft z-10 flex shrink-0 items-center justify-between border-b px-3 py-1.5 shadow-xs backdrop-blur-xs select-none">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFocusedSessionKey(null)
                setControlState('locked')
              }}
              className="border-line text-copy hover:bg-panel-hover h-8 bg-transparent shadow-none transition-all hover:text-ink"
            >
              <ArrowLeft className="mr-2 h-3.5 w-3.5" />
              Back to Grid
            </Button>
            <div className="flex items-baseline gap-2">
              <h2 className="page-title-gradient text-xs font-bold tracking-wider uppercase">
                {focusedSession.profileName}
              </h2>
              <span className="text-subtle-copy font-mono text-[10px]">
                {focusedSession.workflowId} / :{focusedSession.displayNum}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchSessions()}
            className="border-line text-copy hover:bg-panel-hover h-8 bg-transparent shadow-none transition-all hover:text-ink"
          >
            <RefreshCw
              className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        </div>

        <div className="min-h-0 flex-1 p-1">
          <Group
            orientation="horizontal"
            id="vnc-focus-layout-group"
            onLayoutChanged={(layout) => {
              localStorage.setItem(
                'vnc-focus-layout-sizes',
                JSON.stringify(layout),
              )
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
              <div className="bg-shell border-line-soft group relative flex h-full flex-col overflow-hidden rounded-[3px] border shadow-xs">
                <div className="pointer-events-none absolute top-0 right-0 left-0 z-10 flex h-6 items-center bg-gradient-to-b from-black/80 to-transparent px-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="text-muted-copy font-mono text-[10px] tracking-widest uppercase">
                    Display Stream :{focusedSession.displayNum}
                  </div>
                </div>

                <Suspense
                  fallback={
                    <div className="bg-overlay h-full w-full animate-pulse" />
                  }
                >
                  <VncViewer
                    url={buildVncWebSocketUrl(focusedSession.vncPort)}
                    interactive={isInteractive}
                    className="h-full w-full flex-1 object-contain"
                  />
                </Suspense>

                {!isInteractive && (
                  <div
                    className={`absolute inset-0 z-20 flex items-center justify-center transition-colors ${isConfirming ? 'bg-field pointer-events-auto backdrop-blur-xs' : 'pointer-events-none bg-black/0 group-hover:bg-black/25'}`}
                  >
                    <div
                      className={`${isConfirming ? 'mx-4 w-full max-w-[360px]' : ''}`}
                    >
                      <div
                        className={`bg-panel border-line overflow-hidden rounded-lg border shadow-lg sm:rounded-lg ${isConfirming ? 'opacity-100' : 'pointer-events-auto opacity-0 transition-opacity group-hover:opacity-100'}`}
                      >
                        {isConfirming && (
                          <div className="flex flex-col space-y-1.5 px-6 py-4 text-center sm:text-left">
                            <h2 className="brand-text-gradient text-lg leading-none font-semibold tracking-tight">
                              Control Handoff
                            </h2>
                            <p className="text-subtle-copy text-sm">
                              Taking control will interrupt the agent.
                            </p>
                          </div>
                        )}
                        <div
                          className={`flex flex-col-reverse px-6 sm:flex-row sm:justify-end sm:space-x-2 ${isConfirming ? 'pt-2 pb-6' : 'py-6'}`}
                        >
                          {isConfirming ? (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => setControlState('locked')}
                                className="border-line text-copy hover:bg-panel-hover mt-2 border bg-transparent shadow-none transition-all hover:text-ink sm:mt-0"
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={() => setControlState('unlocked')}
                                className="brand-button font-medium"
                              >
                                Confirm
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              onClick={() => setControlState('confirm')}
                              className="bg-field border-line text-copy hover:bg-panel-hover border shadow-none backdrop-blur-xs transition-all hover:text-ink"
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
                  <div className="absolute right-4 bottom-4 z-20">
                    <Button
                      variant="outline"
                      onClick={() => setControlState('locked')}
                      className="bg-overlay-strong border-line text-copy hover:bg-panel-hover border shadow-none backdrop-blur-md transition-all hover:text-ink"
                    >
                      Return To Agent
                    </Button>
                  </div>
                )}
              </div>
            </Panel>

            <Separator className="hover:bg-panel-muted group relative mx-0.5 flex w-2 items-center justify-center rounded-sm transition-colors focus:ring-0 focus:outline-hidden active:outline-hidden">
              <div className="bg-panel-hover h-8 w-1 rounded-full transition-colors group-hover:bg-white/30" />
            </Separator>

            <Panel id="right-logs" defaultSize={40} minSize={20}>
              <div className="flex h-full flex-col overflow-hidden rounded-[3px] shadow-xs">
                <Suspense
                  fallback={
                    <div className="bg-field-alt h-full w-full animate-pulse" />
                  }
                >
                  <LogsViewer
                    className="h-full border-0"
                    workflowId={
                      focusedSession.workflowId === 'manual'
                        ? null
                        : focusedSession.workflowId
                    }
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
    <div className="bg-shell relative flex h-full flex-col overflow-hidden font-sans">
      <AmbientGlow
        className="h-[400px] w-[800px]"
        reducedClassName="w-[560px] h-[240px]"
      />
      <div className="mobile-effect-blur bg-panel-subtle border-line-soft z-10 flex shrink-0 items-center justify-between border-b px-3 py-1.5 shadow-xs backdrop-blur-xs select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="page-title-gradient text-xs font-bold tracking-wider uppercase">
              Active Sessions
            </h2>
            <span className="text-subtle-copy font-mono text-[10px]">
              [{sessions.length} live]
            </span>
          </div>
          <div className="text-muted-copy flex items-center gap-1.5 font-mono text-[10px]">
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? 'status-dot-success' : 'status-dot-danger'
              }`}
            />
            <span
              className={
                connected ? 'text-status-success' : 'text-status-danger'
              }
            >
              {connected ? 'ws connected' : 'ws reconnecting'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchSessions()}
              className="border-line text-copy hover:bg-panel-hover h-8 bg-transparent shadow-none transition-all hover:text-ink"
            >
              <RefreshCw
                className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="z-10 min-h-0 flex-1 overflow-auto p-2">
        {error ? (
          <div className="border-status-danger-border bg-status-danger-soft text-status-danger mb-2 rounded-[3px] border px-3 py-2 text-xs">
            Failed to load displays: {error}
          </div>
        ) : null}

        {sessions.length === 0 ? (
          <div className="border-line bg-panel-subtle text-subtle-copy flex h-full min-h-[260px] flex-col items-center justify-center gap-2 rounded-[4px] border backdrop-blur-xs">
            <LayoutGrid className="h-6 w-6" />
            <p className="text-xs font-medium">No active sessions</p>
            <p className="text-[11px]">
              Start a workflow to see browser displays.
            </p>
          </div>
        ) : (
          <div
            className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-[repeat(auto-fill,minmax(400px,1fr))]'}`}
          >
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




