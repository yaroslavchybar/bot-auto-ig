import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@/lib/router'
import { ApiError, apiFetch } from '@/lib/api'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildVncWebSocketUrl } from '@/features/vnc/utils/buildVncWebSocketUrl'
import { useIsMobile } from '@/hooks/use-mobile'
import { useVncSessions } from './hooks/useVncSessions'
import { decodeRouteParam, sessionKey, type DisplaySession } from './utils/liveSessions'
import { VncClipboardButton } from './components/VncClipboard'

const VncViewer = lazy(() =>
  import('@/features/vnc/components/VncViewer').then((module) => ({
    default: module.VncViewer,
  })),
)

/* ── Session resolution hook ── */

function useVncSessionResolution() {
  const navigate = useNavigate()
  const { automationId: rawAutomationId, profileName: rawProfileName } = useParams()
  const automationId = decodeRouteParam(rawAutomationId)
  const profileName = decodeRouteParam(rawProfileName)
  const { sessions, loading } = useVncSessions()

  const session = useMemo(
    () =>
      sessions.find(
        (item) => item.automationId === automationId && item.profileName === profileName,
      ) ?? null,
    [profileName, sessions, automationId],
  )

  const handleBack = useCallback(() => {
    navigate('/vnc')
  }, [navigate])

  return { automationId, profileName, session, loading, handleBack }
}

export function VncSessionPage() {
  const { automationId, profileName, session, loading, handleBack } = useVncSessionResolution()

  if (!automationId || !profileName) {
    return (
      <VncMissingParamsView
        onBack={handleBack}
        message="Session information is missing from the URL."
      />
    )
  }

  if (loading && !session) {
    return (
      <div className="flex h-full items-center justify-center bg-shell text-sm text-subtle-copy">
        Loading live session...
      </div>
    )
  }

  if (!session) {
    return (
      <VncMissingParamsView onBack={handleBack} message="This live session is no longer active." />
    )
  }

  return <ResolvedVncSessionPage key={sessionKey(session)} session={session} onBack={handleBack} />
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
    <div className="flex h-full items-center justify-center bg-shell p-6">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-line bg-panel p-6 text-center shadow-xs">
        <div>
          <h1 className="text-lg font-semibold text-ink">Session unavailable</h1>
          <p className="mt-2 text-sm text-subtle-copy">{message}</p>
          {error ? <p className="mt-3 text-sm text-status-danger">{error}</p> : null}
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
 * An automation session has a live agent driving the browser, so enabling VNC
 * input directly would race the agent. Taking control therefore stops the
 * automation first and waits for the server ack. The stop kills the worker
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
    } catch {
      /* fall through to raw message */
    }
    return error.message.trim() || `Request failed (HTTP ${error.status})`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

function useControlHandoff(session: DisplaySession): ControlHandoff {
  const [controlState, setControlState] = useState<ControlState>('locked')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isManual = session.automationId === 'manual'

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
        await apiFetch('/api/automations/stop', {
          method: 'POST',
          body: { automationId: session.automationId },
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
  }, [isManual, session.automationId])

  const returnToView = useCallback(() => {
    setError(null)
    setControlState('locked')
  }, [])

  return {
    controlState,
    isManual,
    working,
    error,
    requestTake,
    cancelTake,
    confirmTake,
    returnToView,
    dismissError,
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

  const isInteractive = handoff.controlState === 'unlocked'

  if (isMobile) {
    return <VncMobileLayout session={session} handoff={handoff} onBack={onBack} />
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
  onBack,
}: {
  session: DisplaySession
  handoff: ControlHandoff
  onBack: () => void
}) {
  const isInteractive = handoff.controlState === 'unlocked'
  return (
    <div className="relative flex h-full flex-col overflow-auto bg-shell font-sans">
      <VncMobileHeader session={session} onBack={onBack} />

      <div className="min-h-0 flex-1 space-y-2 p-2">
        <div className="flex gap-2">
          <VncClipboardButton vncPort={session.vncPort} interactive={isInteractive} />
        </div>
        <div className="h-[50vh] min-h-[320px] overflow-hidden rounded-[4px] border border-line-soft bg-black">
          <Suspense fallback={<div className="h-full w-full bg-overlay" />}>
            <VncViewer
              vncPort={session.vncPort}
              url={buildVncWebSocketUrl(session.vncPort)}
              interactive={isInteractive}
              className="h-full w-full flex-1 object-contain"
            />
          </Suspense>
        </div>

        <ControlToggle handoff={handoff} onBack={onBack} />
      </div>
    </div>
  )
}

function VncMobileHeader({ session, onBack }: { session: DisplaySession; onBack: () => void }) {
  return (
    <div className="z-10 flex shrink-0 items-center justify-between border-b border-line-soft bg-panel-subtle px-3 py-2 shadow-xs select-none">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-3.5 w-3.5" />
          Back
        </Button>
        <div className="min-w-0">
          <h2 className="truncate page-title-gradient text-sm font-bold tracking-wider uppercase">
            {session.profileName}
          </h2>
          <span className="font-mono text-[10px] text-subtle-copy">
            {session.automationId} / :{session.displayNum}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Control Toggle ── */

function ControlToggle({ handoff, onBack }: { handoff: ControlHandoff; onBack: () => void }) {
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
      <div className="rounded-xl border border-line bg-panel p-3">
        <p className="mb-1 text-sm font-medium text-copy">Agent stopped</p>
        <p className="mb-3 text-xs text-muted-copy">
          The live stream has ended. To drive this profile by hand, start its browser from Profiles.
        </p>
        <Button variant="outline" onClick={onBack} className="w-full">
          Back to Sessions
        </Button>
      </div>
    )
  }

  const description = isManual
    ? 'No agent is running on this browser. Take control to interact with it.'
    : 'An agent is driving this browser. Taking control stops the agent first.'

  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <p className="mb-3 text-xs text-muted-copy">{description}</p>
      {error ? (
        <p className="mb-3 text-xs text-status-danger" role="alert">
          {error}{' '}
          <Button
            variant="ghost"
            type="button"
            onClick={handoff.dismissError}
            className="underline"
          >
            Dismiss
          </Button>
        </p>
      ) : null}
      <div className="flex gap-2">
        {isConfirming ? (
          <>
            <Button
              variant="outline"
              onClick={handoff.cancelTake}
              disabled={working}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handoff.confirmTake}
              disabled={working}
              className="flex-1 brand-button font-medium"
            >
              {working
                ? isManual
                  ? 'Taking control…'
                  : 'Stopping agent…'
                : isManual
                  ? 'Confirm'
                  : 'Stop Agent'}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={handoff.requestTake} className="w-full">
            Take Control
          </Button>
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
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-shell font-sans">
      <VncDesktopHeader session={session} isInteractive={isInteractive} onBack={onBack} />
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
}: {
  session: DisplaySession
  isInteractive: boolean
  onBack: () => void
}) {
  return (
    <div className="z-10 flex shrink-0 items-center justify-between border-b border-line-soft bg-panel-subtle px-3 py-1.5 shadow-xs select-none">
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-3.5 w-3.5" />
          Back to Grid
        </Button>
        <div className="flex items-baseline gap-2">
          <h2 className="page-title-gradient text-xs font-bold tracking-wider uppercase">
            {session.profileName}
          </h2>
          <span className="font-mono text-[10px] text-subtle-copy">
            {session.automationId} / :{session.displayNum}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <VncClipboardButton vncPort={session.vncPort} interactive={isInteractive} />
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
      <VncStreamPanel
        session={session}
        isInteractive={isInteractive}
        handoff={handoff}
        onBack={onBack}
      />
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
    <div className="group relative flex h-full flex-col overflow-hidden rounded-[3px] border border-line-soft bg-shell shadow-xs">
      <div className="pointer-events-none absolute top-0 right-0 left-0 z-10 flex h-6 items-center bg-gradient-to-b from-black/80 to-transparent px-2 opacity-0 group-hover:opacity-100">
        <div className="font-mono text-[10px] tracking-widest text-muted-copy uppercase">
          Display Stream :{session.displayNum}
        </div>
      </div>

      <Suspense fallback={<div className="h-full w-full bg-overlay" />}>
        <VncViewer
          vncPort={session.vncPort}
          url={buildVncWebSocketUrl(session.vncPort)}
          interactive={isInteractive}
          className="h-full w-full flex-1 object-contain"
        />
      </Suspense>

      {!isInteractive && <VncControlOverlay handoff={handoff} onBack={onBack} />}

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

function VncControlOverlay({ handoff, onBack }: { handoff: ControlHandoff; onBack: () => void }) {
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
      className={`absolute inset-0 z-20 flex items-center justify-center ${showCard ? 'pointer-events-auto bg-overlay' : 'pointer-events-none bg-black/0 group-hover:bg-black/25'}`}
    >
      <div className={`${showCard ? 'mx-4 w-full max-w-[360px]' : ''}`}>
        <div
          className={`overflow-hidden rounded-lg border border-line bg-panel shadow-lg sm:rounded-lg ${showCard ? 'opacity-100' : 'pointer-events-auto opacity-0 group-hover:opacity-100'}`}
        >
          {showCard && (
            <div className="flex flex-col space-y-1.5 px-6 py-4 text-center sm:text-left">
              <h2 className="brand-text-gradient text-lg leading-none font-semibold tracking-tight">
                {title}
              </h2>
              <p className="text-sm text-subtle-copy">{description}</p>
              {error ? (
                <p className="text-sm text-status-danger" role="alert">
                  {error}{' '}
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={handoff.dismissError}
                    className="underline"
                  >
                    Dismiss
                  </Button>
                </p>
              ) : null}
            </div>
          )}
          <div
            className={`flex flex-col-reverse px-6 sm:flex-row sm:justify-end sm:space-x-2 ${showCard ? 'pt-2 pb-6' : 'py-6'}`}
          >
            {isStopped ? (
              <Button variant="outline" onClick={onBack}>
                Back to Sessions
              </Button>
            ) : isConfirming ? (
              <>
                <Button
                  variant="outline"
                  onClick={handoff.cancelTake}
                  disabled={working}
                  className="mt-2 sm:mt-0"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handoff.confirmTake}
                  disabled={working}
                  className="brand-button font-medium"
                >
                  {working
                    ? isManual
                      ? 'Taking control…'
                      : 'Stopping agent…'
                    : isManual
                      ? 'Confirm'
                      : 'Stop Agent'}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={handoff.requestTake}>
                Take Control
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
