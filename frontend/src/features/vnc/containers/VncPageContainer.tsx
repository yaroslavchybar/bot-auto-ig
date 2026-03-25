import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { LayoutGrid, RefreshCw } from 'lucide-react'
import { VncTile } from '../components/VncTile'
import { Button } from '@/components/ui/button'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useVncSessions } from '../hooks/useVncSessions'
import { useRouteActive } from '@/hooks/useRouteActive'
import { buildVncSessionPath, sessionKey } from '../utils/liveSessions'

export function VncPageContainer() {
  const navigate = useNavigate()
  const isActive = useRouteActive('/vnc')
  const { sessions, loading, connected, refresh } = useVncSessions(isActive)
  const [refreshing, setRefreshing] = useState(false)

  const handleSelect = useCallback(
    (workflowId: string, profileName: string) => {
      navigate(buildVncSessionPath({ workflowId, profileName }))
    },
    [navigate],
  )

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([refresh(), new Promise((resolve) => setTimeout(resolve, 300))])
    } finally { setRefreshing(false) }
  }, [refresh])

  return (
    <div className="bg-shell relative flex h-full flex-col overflow-hidden font-sans">
      <AmbientGlow className="h-[400px] w-[800px]" reducedClassName="w-[560px] h-[240px]" />
      <VncHeader
        sessionCount={sessions.length}
        connected={connected}
        loading={loading}
        refreshing={refreshing}
        onRefresh={() => void handleRefresh()}
      />
      <VncSessionGrid
        sessions={sessions}
        onSelect={handleSelect}
      />
    </div>
  )
}

/* ── Header ── */

function VncHeader({
  sessionCount, connected, loading, refreshing, onRefresh,
}: {
  sessionCount: number; connected: boolean; loading: boolean; refreshing: boolean
  onRefresh: () => void
}) {
  return (
    <div className="mobile-effect-blur bg-panel-subtle border-line-soft z-10 flex shrink-0 items-center justify-between border-b px-3 py-1.5 shadow-xs backdrop-blur-xs select-none">
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="page-title-gradient text-xs font-bold tracking-wider uppercase">Active Sessions</h2>
          <span className="text-subtle-copy font-mono text-[10px]">[{sessionCount} live]</span>
        </div>
        <div className="text-muted-copy flex items-center gap-1.5 font-mono text-[10px]">
          <span className={`h-2 w-2 rounded-full ${connected ? 'status-dot-success' : 'status-dot-danger'}`} />
          <span className={connected ? 'text-status-success' : 'text-status-danger'}>
            {connected ? 'ws connected' : 'ws reconnecting'}
          </span>
        </div>
        <Button variant="outline" size="icon" onClick={onRefresh} disabled={loading || refreshing}
          aria-label="Refresh sessions" title="Refresh sessions" className="h-8 w-8 shrink-0 p-0">
          <RefreshCw className={loading || refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          <span className="sr-only">Refresh</span>
        </Button>
      </div>
    </div>
  )
}

/* ── Session grid ── */

function VncSessionGrid({
  sessions, onSelect,
}: {
  sessions: ReturnType<typeof useVncSessions>['sessions']
  onSelect: (workflowId: string, profileName: string) => void
}) {
  return (
    <div className="z-10 min-h-0 flex-1 overflow-auto p-2">
      {sessions.length === 0 ? (
        <div className="border-line bg-panel-subtle text-subtle-copy flex h-full min-h-[260px] flex-col items-center justify-center gap-2 rounded-[4px] border backdrop-blur-xs">
          <LayoutGrid className="h-6 w-6" />
          <p className="text-xs font-medium">No active sessions</p>
          <p className="text-[11px]">Start a workflow to see browser displays.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[repeat(auto-fill,minmax(400px,1fr))]">
          {sessions.map((session) => (
            <VncTile key={sessionKey(session)} session={session}
              onSelect={() => onSelect(session.workflowId, session.profileName)} />
          ))}
        </div>
      )}
    </div>
  )
}
