import { Monitor } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import type { DisplaySession } from '../utils/liveSessions'
import { VncPreview } from './VncPreview'

type VncTileProps = {
  session: DisplaySession
  onSelect: () => void
}

export function VncTile({ session, onSelect }: VncTileProps) {
  const isMobile = useIsMobile()

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex min-h-[220px] flex-col overflow-hidden rounded-[4px] button-panel text-left shadow-xs"
    >
      <div className="flex h-8 items-center justify-between border-b border-line-soft bg-transparent px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-copy" />
          <span className="truncate text-[11px] font-semibold text-ink">{session.profileName}</span>
          <span className="shrink-0 font-mono text-[10px] text-subtle-copy">
            :{session.displayNum}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-status-success">
          <span className="h-2 w-2 rounded-full status-dot-success" />
          active
        </div>
      </div>

      <div className="relative min-h-[200px] flex-1">
        {isMobile ? (
          <div className="flex h-full items-center justify-center bg-overlay text-center text-xs text-muted-copy">
            <div className="space-y-2 px-4">
              <Monitor className="mx-auto h-6 w-6 text-subtle-copy" />
              <div>Open session to start the live display stream.</div>
            </div>
          </div>
        ) : (
          <VncPreview vncPort={session.vncPort} />
        )}
        <div className="absolute right-2 bottom-2 rounded-[3px] bg-black/55 px-2 py-1 font-mono text-[10px] text-white/80 opacity-0 group-hover:opacity-100">
          {session.automationId}
        </div>
      </div>
    </button>
  )
}
