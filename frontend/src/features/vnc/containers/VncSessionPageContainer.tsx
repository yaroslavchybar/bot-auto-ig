import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { ArrowLeft, FileText, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buildVncWebSocketUrl } from '@/features/vnc/utils/buildVncWebSocketUrl'
import { useIsMobile } from '@/hooks/use-mobile'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useVncSessions } from '../hooks/useVncSessions'
import { decodeRouteParam, sessionKey, type DisplaySession } from '../utils/liveSessions'

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

export function VncSessionPageContainer() {
  const navigate = useNavigate()
  const { workflowId: rawWorkflowId, profileName: rawProfileName } = useParams()
  const workflowId = decodeRouteParam(rawWorkflowId)
  const profileName = decodeRouteParam(rawProfileName)
  const { sessions, loading, error, refresh } = useVncSessions()
  const [refreshing, setRefreshing] = useState(false)

  const session = useMemo(
    () =>
      sessions.find(
        (item) =>
          item.workflowId === workflowId && item.profileName === profileName,
      ) ?? null,
    [profileName, sessions, workflowId],
  )

  const handleBack = useCallback(() => {
    navigate('/vnc')
  }, [navigate])

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        refresh(),
        new Promise((resolve) => setTimeout(resolve, 300)),
      ])
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  if (!workflowId || !profileName) {
    return (
      <div className="bg-shell flex h-full items-center justify-center p-6">
        <div className="bg-panel border-line flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-6 text-center shadow-xs">
          <div>
            <h1 className="text-ink text-lg font-semibold">Session unavailable</h1>
            <p className="text-subtle-copy mt-2 text-sm">
              Session information is missing from the URL.
            </p>
          </div>
          <div className="flex justify-center">
            <Button onClick={handleBack} className="brand-button">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Sessions
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (loading && !session && !refreshing) {
    return (
      <div className="bg-shell text-subtle-copy flex h-full items-center justify-center text-sm">
        Loading live session...
      </div>
    )
  }

  if (!session) {
    return (
      <div className="bg-shell flex h-full items-center justify-center p-6">
        <div className="bg-panel border-line flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-6 text-center shadow-xs">
          <div>
            <h1 className="text-ink text-lg font-semibold">Session unavailable</h1>
            <p className="text-subtle-copy mt-2 text-sm">
              This live session is no longer active.
            </p>
            {error ? (
              <p className="text-status-danger mt-3 text-sm">
                Failed to refresh displays: {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => void handleManualRefresh()}
              disabled={loading || refreshing}
              className="border-line bg-field hover:bg-panel-hover text-copy"
            >
              <RefreshCw
                className={
                  loading || refreshing
                    ? 'mr-2 h-4 w-4 animate-spin'
                    : 'mr-2 h-4 w-4'
                }
              />
              Refresh
            </Button>
            <Button onClick={handleBack} className="brand-button">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Sessions
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ResolvedVncSessionPage
      key={sessionKey(session)}
      session={session}
      loading={loading || refreshing}
      onBack={handleBack}
      onRefresh={handleManualRefresh}
    />
  )
}

function ResolvedVncSessionPage({
  session,
  loading,
  onBack,
  onRefresh,
}: {
  session: DisplaySession
  loading: boolean
  onBack: () => void
  onRefresh: () => Promise<void>
}) {
  const isMobile = useIsMobile()
  const [controlState, setControlState] = useState<
    'locked' | 'confirm' | 'unlocked'
  >('locked')
  const [showMobileLogs, setShowMobileLogs] = useState(false)

  const isInteractive = controlState === 'unlocked'
  const isConfirming = controlState === 'confirm'

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
              onClick={onBack}
              className="h-8"
            >
              <ArrowLeft className="mr-2 h-3.5 w-3.5" />
              Back
            </Button>
            <div className="min-w-0">
              <h2 className="page-title-gradient truncate text-sm font-bold tracking-wider uppercase">
                {session.profileName}
              </h2>
              <span className="text-subtle-copy font-mono text-[10px]">
                {session.workflowId} / :{session.displayNum}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMobileLogs((current) => !current)}
            className="h-8"
          >
            <FileText className="h-3.5 w-3.5" />
            {showMobileLogs ? 'Hide Logs' : 'Show Logs'}
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 p-2">
          <div className="border-line-soft h-[50vh] min-h-[320px] overflow-hidden rounded-[4px] border bg-black">
            <Suspense
              fallback={<div className="bg-overlay h-full w-full animate-pulse" />}
            >
              <VncViewer
                url={buildVncWebSocketUrl(session.vncPort)}
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
                      className="flex-1"
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
                    className="w-full"
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
            >
              Return To Agent
            </Button>
          )}

          {showMobileLogs ? (
            <div className="border-line-soft bg-shell h-[42vh] min-h-[260px] overflow-hidden rounded-[4px] border">
              <Suspense
                fallback={<div className="bg-field-alt h-full w-full animate-pulse" />}
              >
                <LogsViewer
                  className="h-full border-0"
                  workflowId={session.workflowId === 'manual' ? null : session.workflowId}
                  profileName={session.profileName}
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
            onClick={onBack}
            className="h-8"
          >
            <ArrowLeft className="mr-2 h-3.5 w-3.5" />
            Back to Grid
          </Button>
          <div className="flex items-baseline gap-2">
            <h2 className="page-title-gradient text-xs font-bold tracking-wider uppercase">
              {session.profileName}
            </h2>
            <span className="text-subtle-copy font-mono text-[10px]">
              {session.workflowId} / :{session.displayNum}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void onRefresh()}
          aria-label="Refresh sessions"
          title="Refresh sessions"
          className="h-8 w-8 shrink-0 p-0"
        >
          <RefreshCw
            className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
          />
          <span className="sr-only">Refresh</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 p-1">
        <Group
          orientation="horizontal"
          id={`vnc-session-layout-${sessionKey(session)}`}
          onLayoutChanged={(layout) => {
            localStorage.setItem(
              `vnc-focus-layout-sizes-${sessionKey(session)}`,
              JSON.stringify(layout),
            )
          }}
          defaultLayout={(() => {
            try {
              const stored = localStorage.getItem(
                `vnc-focus-layout-sizes-${sessionKey(session)}`,
              )
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
                  Display Stream :{session.displayNum}
                </div>
              </div>

              <Suspense
                fallback={<div className="bg-overlay h-full w-full animate-pulse" />}
              >
                <VncViewer
                  url={buildVncWebSocketUrl(session.vncPort)}
                  interactive={isInteractive}
                  className="h-full w-full flex-1 object-contain"
                />
              </Suspense>

              {!isInteractive && (
                <div
                  className={`absolute inset-0 z-20 flex items-center justify-center transition-colors ${isConfirming ? 'pointer-events-none bg-black/0' : 'pointer-events-none bg-black/0 group-hover:bg-black/25'}`}
                >
                  <div>
                    <div className="bg-panel border-line pointer-events-auto overflow-hidden rounded-lg border opacity-0 shadow-lg transition-opacity group-hover:opacity-100 sm:rounded-lg">
                      <div className="px-6 py-6">
                        <Button
                          variant="outline"
                          onClick={() => setControlState('confirm')}
                        >
                          Take Control
                        </Button>
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
                fallback={<div className="bg-field-alt h-full w-full animate-pulse" />}
              >
                <LogsViewer
                  className="h-full border-0"
                  workflowId={session.workflowId === 'manual' ? null : session.workflowId}
                  profileName={session.profileName}
                />
              </Suspense>
            </div>
          </Panel>
        </Group>
      </div>

      <AlertDialog
        open={isConfirming}
        onOpenChange={(open) => setControlState(open ? 'confirm' : 'locked')}
      >
        <AlertDialogContent className="max-w-[28rem]">
          <AlertDialogHeader>
            <AlertDialogTitle className="brand-text-gradient">
              Control Handoff
            </AlertDialogTitle>
            <AlertDialogDescription className="text-subtle-copy">
              Taking control will interrupt the agent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => setControlState('unlocked')}
              className="brand-button font-medium"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
