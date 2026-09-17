import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@/lib/router'
import { ApiError, apiFetch } from '@/lib/api'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { ArrowLeft, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildVncWebSocketUrl } from '@/features/vnc/utils/buildVncWebSocketUrl'
import { useIsMobile } from '@/hooks/use-mobile'
import { useVncSessions } from './hooks/useVncSessions'
import { decodeRouteParam, sessionKey, type DisplaySession } from './utils/liveSessions'
import { useVncFileUpload, VncFilesButton, VncUploadButton, type VpsUpload } from './components/VncUpload'
import { VncClipboardButton } from './components/VncClipboard'

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

/* ── Session resolution hook ── */

function useVncSessionResolution() {
  const navigate = useNavigate()
  const { workflowId: rawWorkflowId, profileName: rawProfileName } = useParams()
  const workflowId = decodeRouteParam(rawWorkflowId)
  const profileName = decodeRouteParam(rawProfileName)
  const { sessions, loading } = useVncSessions(true)

  const session = useMemo(
    () => sessions.find(
      (item) => item.workflowId === workflowId && item.profileName === profileName,
    ) ?? null,
    [profileName, sessions, workflowId],
  )

  const handleBack = useCallback(() => { navigate('/vnc') }, [navigate])

  return { workflowId, profileName, session, loading, handleBack }
}

export function VncSessionPage() {
  const {
    workflowId, profileName, session, loading,
    handleBack,
  } = useVncSessionResolution()

  if (!workflowId || !profileName) {
    return <VncMissingParamsView onBack={handleBack} message="Session information is missing from the URL." />
  }

  if (loading && !session) {
    return (
      <div className="bg-shell text-subtle-copy flex h-full items-center justify-center text-sm">
        Loading live session...
      </div>
    )
  }

  if (!session) {
    return (
      <VncMissingParamsView
        onBack={handleBack}
        message="This live session is no longer active."
      />
    )
  }

  return (
    <ResolvedVncSessionPage
      key={sessionKey(session)} session={session}
      onBack={handleBack}
    />
  )
}

/* ── Missing/error view ── */

function VncMissingParamsView({
  onBack,
  message,
  error,
}: {
  onBack: () => void
  message: string
  error?: string
}) {
  return (
    <div className="bg-shell flex h-full items-center justify-center p-6">
      <div className="bg-panel border-line flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-6 text-center shadow-xs">
        <div>
          <h1 className="text-ink text-lg font-semibold">Session unavailable</h1>
          <p className="text-subtle-copy mt-2 text-sm">{message}</p>
          {error ? <p className="text-status-danger mt-3 text-sm">{error}</p> : null}
        </div>
        <div className="flex justify-center gap-3">
          <Button onClick={onBack} className="brand-button">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Sessions
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Control handoff ──
 *
 * A workflow session has a live agent driving the browser, so enabling VNC
 * input directly would race the agent. Taking control therefore stops the
 * workflow first and waits for the server ack. The stop kills the worker
 * (and its browser stream), so input stays locked and the UI says so.
 * Manual sessions have no agent, so input unlocks immediately.
 */

type ControlState = 'locked' | 'confirm' | 'unlocked' | 'agent-stopped'

type ControlHandoff = {
  controlState: ControlState
  isManual: boolean
  working: boolean
  error: string | null
  requestTake: () => void
  cancelTake: () => void
  confirmTake: () => void
  returnToView: () => void
  dismissError: () => void
}

function handoffErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.message) as { error?: { message?: unknown } }
      const message = parsed?.error?.message
      if (typeof message === 'string' && message.trim()) return message
    } catch { /* fall through to raw message */ }
    return error.message.trim() || `Request failed (HTTP ${error.status})`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

function useControlHandoff(session: DisplaySession): ControlHandoff {
  const [controlState, setControlState] = useState<ControlState>('locked')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isManual = session.workflowId === 'manual'

  const requestTake = useCallback(() => {
    setError(null)
    setControlState('confirm')
  }, [])

  const cancelTake = useCallback(() => {
    if (working) return
    setError(null)
    setControlState('locked')
  }, [working])

  const dismissError = useCallback(() => setError(null), [])

  const confirmTake = useCallback(() => {
    // No agent owns a manual browser — unlock input without a round trip.
    if (isManual) {
      setControlState('unlocked')
      return
    }
    setWorking(true)
    setError(null)
    void (async () => {
      try {
        await apiFetch('/api/workflows/stop', {
          method: 'POST',
          body: { workflowId: session.workflowId },
        })
        setControlState('agent-stopped')
      } catch (e) {
        // "Not running" still means no agent drives the browser — safe.
        if (e instanceof ApiError && e.status === 400) {
          setControlState('agent-stopped')
        } else {
          setError(handoffErrorMessage(e))
        }
      } finally {
        setWorking(false)
      }
    })()
  }, [isManual, session.workflowId])

  const returnToView = useCallback(() => {
    setError(null)
    setControlState('locked')
  }, [])

  return {
    controlState, isManual, working, error,
    requestTake, cancelTake, confirmTake, returnToView, dismissError,
  }
}

/* ── Resolved page ── */

function ResolvedVncSessionPage({
  session,
  onBack,
}: {
  session: DisplaySession
  onBack: () => void
}) {
  const isMobile = useIsMobile()
  const handoff = useControlHandoff(session)
  const [showMobileLogs, setShowMobileLogs] = useState(false)

  const isInteractive = handoff.controlState === 'unlocked'

  if (isMobile) {
    return (
      <VncMobileLayout
        session={session}
        handoff={handoff}
        showMobileLogs={showMobileLogs}
        onBack={onBack}
        onToggleLogs={() => setShowMobileLogs((c) => !c)}
      />
    )
  }

  return (
    <VncDesktopLayout
      session={session}
      handoff={handoff}
      isInteractive={isInteractive}
      onBack={onBack}
    />
  )
}

/* ── Mobile Layout ── */

function VncMobileLayout({
  session,
  handoff,
  showMobileLogs,
  onBack,
  onToggleLogs,
}: {
  session: DisplaySession
  handoff: ControlHandoff
  showMobileLogs: boolean
  onBack: () => void
  onToggleLogs: () => void
}) {
  const isInteractive = handoff.controlState === 'unlocked'
  const upload = useVncFileUpload()
  return (
    <div className="bg-shell relative flex h-full flex-col overflow-auto font-sans">
      {upload.input}
      <VncMobileHeader session={session} onBack={onBack} onToggleLogs={onToggleLogs} showMobileLogs={showMobileLogs} />

      <div className="min-h-0 flex-1 space-y-2 p-2">
        <div className="flex gap-2">
          <VncUploadButton uploading={upload.uploading} onClick={upload.openPicker} />
          <VncFilesButton
            files={upload.files}
            onDelete={(name) => void upload.removeFile(name)}
            onRefresh={() => void upload.refreshFiles()}
          />
          <VncClipboardButton vncPort={session.vncPort} interactive={isInteractive} />
        </div>
        <div className="border-line-soft h-[50vh] min-h-[320px] overflow-hidden rounded-[4px] border bg-black">
          <Suspense fallback={<div className="bg-overlay h-full w-full animate-pulse" />}>
            <VncViewer
              url={buildVncWebSocketUrl(session.vncPort)}
              interactive={isInteractive}
              className="h-full w-full flex-1 object-contain"
            />
          </Suspense>
        </div>

        <ControlToggle handoff={handoff} onBack={onBack} />

        {showMobileLogs ? (
          <div className="border-line-soft bg-shell h-[42vh] min-h-[260px] overflow-hidden rounded-[4px] border">
            <Suspense fallback={<div className="bg-field-alt h-full w-full animate-pulse" />}>
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

function VncMobileHeader({
  session,
  onBack,
  onToggleLogs,
  showMobileLogs,
}: {
  session: DisplaySession
  onBack: () => void
  onToggleLogs: () => void
  showMobileLogs: boolean
}) {
  return (
    <div className="mobile-effect-blur bg-panel-subtle border-line-soft z-10 flex shrink-0 items-center justify-between border-b px-3 py-2 shadow-xs select-none">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack} className="h-8">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" />Back
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
      <Button variant="outline" size="sm" onClick={onToggleLogs} className="h-8">
        <FileText className="h-3.5 w-3.5" />
        {showMobileLogs ? 'Hide Logs' : 'Show Logs'}
      </Button>
    </div>
  )
}

/* ── Control Toggle ── */

function ControlToggle({
  handoff,
  onBack,
}: {
  handoff: ControlHandoff
  onBack: () => void
}) {
  const { controlState, isManual, working, error } = handoff
  const isConfirming = controlState === 'confirm'

  if (controlState === 'unlocked') {
    return (
      <Button variant="outline" onClick={handoff.returnToView}>
        Return To View
      </Button>
    )
  }

  if (controlState === 'agent-stopped') {
    return (
      <div className="border-line bg-panel rounded-xl border p-3">
        <p className="text-copy mb-1 text-sm font-medium">Agent stopped</p>
        <p className="text-muted-copy mb-3 text-xs">
          The live stream has ended. To drive this profile by hand, start its
          browser from Profiles.
        </p>
        <Button variant="outline" onClick={onBack} className="w-full">Back to Sessions</Button>
      </div>
    )
  }

  const description = isManual
    ? 'No agent is running on this browser. Take control to interact with it.'
    : 'An agent is driving this browser. Taking control stops the agent first.'

  return (
    <div className="border-line bg-panel rounded-xl border p-3">
      <p className="text-muted-copy mb-3 text-xs">{description}</p>
      {error ? (
        <p className="text-status-danger mb-3 text-xs" role="alert">
          {error}{' '}
          <button type="button" onClick={handoff.dismissError} className="underline">Dismiss</button>
        </p>
      ) : null}
      <div className="flex gap-2">
        {isConfirming ? (
          <>
            <Button variant="outline" onClick={handoff.cancelTake} disabled={working} className="flex-1">Cancel</Button>
            <Button onClick={handoff.confirmTake} disabled={working} className="mobile-effect-shadow brand-button flex-1 font-medium">
              {working ? (isManual ? 'Taking control…' : 'Stopping agent…') : isManual ? 'Confirm' : 'Stop Agent'}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={handoff.requestTake} className="w-full">Take Control</Button>
        )}
      </div>
    </div>
  )
}

/* ── Desktop Layout ── */

function VncDesktopLayout({
  session,
  handoff,
  isInteractive,
  onBack,
}: {
  session: DisplaySession
  handoff: ControlHandoff
  isInteractive: boolean
  onBack: () => void
}) {
  const upload = useVncFileUpload()
  return (
    <div className="bg-shell relative flex h-full flex-col overflow-hidden font-sans">
      {upload.input}
      <VncDesktopHeader
        session={session}
        isInteractive={isInteractive}
        onBack={onBack}
        uploading={upload.uploading}
        onUpload={upload.openPicker}
        files={upload.files}
        onDeleteFile={(name) => void upload.removeFile(name)}
        onRefreshFiles={() => void upload.refreshFiles()}
      />
      <VncDesktopPanels
        session={session}
        isInteractive={isInteractive}
        handoff={handoff}
        onBack={onBack}
      />
    </div>
  )
}

function VncDesktopHeader({
  session,
  isInteractive,
  onBack,
  uploading,
  onUpload,
  files,
  onDeleteFile,
  onRefreshFiles,
}: {
  session: DisplaySession
  isInteractive: boolean
  onBack: () => void
  uploading: boolean
  onUpload: () => void
  files: VpsUpload[]
  onDeleteFile: (name: string) => void
  onRefreshFiles: () => void
}) {
  return (
    <div className="mobile-effect-blur bg-panel-subtle border-line-soft z-10 flex shrink-0 items-center justify-between border-b px-3 py-1.5 shadow-xs backdrop-blur-xs select-none">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack} className="h-8">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" />Back to Grid
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
      <div className="flex items-center gap-2">
        <VncClipboardButton vncPort={session.vncPort} interactive={isInteractive} />
        <VncUploadButton uploading={uploading} onClick={onUpload} />
        <VncFilesButton files={files} onDelete={onDeleteFile} onRefresh={onRefreshFiles} />
      </div>
    </div>
  )
}

function VncDesktopPanels({
  session,
  isInteractive,
  handoff,
  onBack,
}: {
  session: DisplaySession
  isInteractive: boolean
  handoff: ControlHandoff
  onBack: () => void
}) {
  return (
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
            const stored = localStorage.getItem(`vnc-focus-layout-sizes-${sessionKey(session)}`)
            return stored ? JSON.parse(stored) : undefined
          } catch { return undefined }
        })()}
      >
        <Panel id="left-vnc" defaultSize={60} minSize={30}>
          <VncStreamPanel
            session={session}
            isInteractive={isInteractive}
            handoff={handoff}
            onBack={onBack}
          />
        </Panel>

        <Separator className="hover:bg-panel-muted group relative mx-0.5 flex w-2 items-center justify-center rounded-sm transition-colors focus:ring-0 focus:outline-hidden active:outline-hidden">
          <div className="bg-panel-hover h-8 w-1 rounded-full transition-colors group-hover:bg-white/30" />
        </Separator>

        <Panel id="right-logs" defaultSize={40} minSize={20}>
          <div className="flex h-full flex-col overflow-hidden rounded-[3px] shadow-xs">
            <Suspense fallback={<div className="bg-field-alt h-full w-full animate-pulse" />}>
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
  )
}

/* ── VNC Stream Panel with overlay ── */

function VncStreamPanel({
  session,
  isInteractive,
  handoff,
  onBack,
}: {
  session: DisplaySession
  isInteractive: boolean
  handoff: ControlHandoff
  onBack: () => void
}) {
  return (
    <div className="bg-shell border-line-soft group relative flex h-full flex-col overflow-hidden rounded-[3px] border shadow-xs">
      <div className="pointer-events-none absolute top-0 right-0 left-0 z-10 flex h-6 items-center bg-gradient-to-b from-black/80 to-transparent px-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="text-muted-copy font-mono text-[10px] tracking-widest uppercase">
          Display Stream :{session.displayNum}
        </div>
      </div>

      <Suspense fallback={<div className="bg-overlay h-full w-full animate-pulse" />}>
        <VncViewer
          url={buildVncWebSocketUrl(session.vncPort)}
          interactive={isInteractive}
          className="h-full w-full flex-1 object-contain"
        />
      </Suspense>

      {!isInteractive && (
        <VncControlOverlay handoff={handoff} onBack={onBack} />
      )}

      {isInteractive && (
        <div className="absolute right-4 bottom-4 z-20">
          <Button variant="outline" onClick={handoff.returnToView}>
            Return To View
          </Button>
        </div>
      )}
    </div>
  )
}

function VncControlOverlay({
  handoff,
  onBack,
}: {
  handoff: ControlHandoff
  onBack: () => void
}) {
  const { controlState, isManual, working, error } = handoff
  const isConfirming = controlState === 'confirm'
  const isStopped = controlState === 'agent-stopped'
  const showCard = isConfirming || isStopped

  const title = isStopped ? 'Agent Stopped' : 'Control Handoff'
  const description = isStopped
    ? 'The live stream has ended. To drive this profile by hand, start its browser from Profiles.'
    : isManual
      ? 'No agent is running on this browser. Take control to interact with it.'
      : 'Taking control stops the agent. The live stream will end.'

  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center transition-colors ${showCard ? 'bg-overlay pointer-events-auto backdrop-blur-xs' : 'pointer-events-none bg-black/0 group-hover:bg-black/25'}`}
    >
      <div className={`${showCard ? 'mx-4 w-full max-w-[360px]' : ''}`}>
        <div
          className={`bg-panel border-line overflow-hidden rounded-lg border shadow-lg sm:rounded-lg ${showCard ? 'opacity-100' : 'pointer-events-auto opacity-0 transition-opacity group-hover:opacity-100'}`}
        >
          {showCard && (
            <div className="flex flex-col space-y-1.5 px-6 py-4 text-center sm:text-left">
              <h2 className="brand-text-gradient text-lg leading-none font-semibold tracking-tight">
                {title}
              </h2>
              <p className="text-subtle-copy text-sm">
                {description}
              </p>
              {error ? (
                <p className="text-status-danger text-sm" role="alert">
                  {error}{' '}
                  <button type="button" onClick={handoff.dismissError} className="underline">Dismiss</button>
                </p>
              ) : null}
            </div>
          )}
          <div
            className={`flex flex-col-reverse px-6 sm:flex-row sm:justify-end sm:space-x-2 ${showCard ? 'pt-2 pb-6' : 'py-6'}`}
          >
            {isStopped ? (
              <Button variant="outline" onClick={onBack}>Back to Sessions</Button>
            ) : isConfirming ? (
              <>
                <Button variant="outline" onClick={handoff.cancelTake} disabled={working} className="mt-2 sm:mt-0">Cancel</Button>
                <Button onClick={handoff.confirmTake} disabled={working} className="brand-button font-medium">
                  {working ? (isManual ? 'Taking control…' : 'Stopping agent…') : isManual ? 'Confirm' : 'Stop Agent'}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={handoff.requestTake}>Take Control</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
