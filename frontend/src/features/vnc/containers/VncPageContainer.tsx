import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { LayoutGrid, RefreshCw } from 'lucide-react'
import { VncTile } from '../components/VncTile'
import { Button } from '@/components/ui/button'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useVncSessions } from '../hooks/useVncSessions'
import { buildVncSessionPath, sessionKey } from '../utils/liveSessions'

export function VncPageContainer() {
  const navigate = useNavigate()
  const { sessions, loading, error, connected, refresh } = useVncSessions()

  const handleSelect = useCallback(
    (workflowId: string, profileName: string) => {
      navigate(buildVncSessionPath({ workflowId, profileName }))
    },
    [navigate],
  )

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
              className={connected ? 'text-status-success' : 'text-status-danger'}
            >
              {connected ? 'ws connected' : 'ws reconnecting'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => void refresh()}
              aria-label="Refresh sessions"
              title="Refresh sessions"
              className="h-8 w-8 shrink-0 rounded-md border-transparent bg-[rgb(51,51,62)] p-0 text-[rgb(163,163,177)] shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.05),0_2px_2px_-1px_rgba(0,0,0,0.16),0_4px_4px_-2px_rgba(0,0,0,0.24),0_0_0_1px_rgba(0,0,0,0.1)] transition-[background-color,box-shadow,color] hover:bg-[rgb(58,58,70)] hover:text-[rgb(246,246,247)] focus-visible:ring-0"
            >
              <RefreshCw
                className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
              />
              <span className="sr-only">Refresh</span>
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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[repeat(auto-fill,minmax(400px,1fr))]">
            {sessions.map((session) => (
              <VncTile
                key={sessionKey(session)}
                session={session}
                onSelect={() =>
                  handleSelect(session.workflowId, session.profileName)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
