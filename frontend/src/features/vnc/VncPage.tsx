import { useCallback } from 'react'
import { useNavigate } from '@/lib/router'
import { LayoutGrid } from 'lucide-react'
import { VncTile } from './components/VncTile'
import { useVncSessions } from './hooks/useVncSessions'
import { useRouteActive } from '@/hooks/useRouteActive'
import { buildVncSessionPath, sessionKey } from './utils/liveSessions'

export function VncPage() {
  const navigate = useNavigate()
  const isActive = useRouteActive('/vnc')
  const { sessions } = useVncSessions(isActive)

  const handleSelect = useCallback(
    (automationId: string, profileName: string) => {
      navigate(buildVncSessionPath({ automationId, profileName }))
    },
    [navigate],
  )

  return (
    <div className="bg-shell relative flex h-full flex-col overflow-hidden font-sans">
      <VncSessionGrid
        sessions={sessions}
        onSelect={handleSelect}
      />
    </div>
  )
}

/* ── Session grid ── */

function VncSessionGrid({
  sessions, onSelect,
}: {
  sessions: ReturnType<typeof useVncSessions>['sessions']
  onSelect: (automationId: string, profileName: string) => void
}) {
  return (
    <div className="z-10 min-h-0 flex-1 overflow-auto p-2">
      {sessions.length === 0 ? (
        <div className="border-line bg-panel-subtle text-subtle-copy flex h-full min-h-[260px] flex-col items-center justify-center gap-2 rounded-[4px] border backdrop-blur-xs">
          <LayoutGrid className="h-6 w-6" />
          <p className="text-xs font-medium">No active sessions</p>
          <p className="text-[11px]">Start an automation to see browser displays.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[repeat(auto-fill,minmax(400px,1fr))]">
          {sessions.map((session) => (
            <VncTile key={sessionKey(session)} session={session}
              onSelect={() => onSelect(session.automationId, session.profileName)} />
          ))}
        </div>
      )}
    </div>
  )
}
