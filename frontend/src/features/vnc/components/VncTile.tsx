import { lazy, Suspense } from 'react'
import { Monitor } from 'lucide-react'
import { buildVncWebSocketUrl } from '@/features/vnc/utils/buildVncWebSocketUrl'
import { useIsMobile } from '@/hooks/use-mobile'

const VncViewer = lazy(() =>
  import('@/features/vnc/components/VncViewer').then((module) => ({
    default: module.VncViewer,
  })),
)

export type DisplaySession = {
  workflowId: string
  profileName: string
  vncPort: number
  displayNum: number
  status: 'active'
}

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
      className="group bg-panel-subtle border-line-soft hover:bg-panel-selected hover:border-line flex min-h-[220px] flex-col overflow-hidden rounded-[4px] border text-left shadow-xs transition-colors"
    >
      <div className="border-line-soft flex h-8 items-center justify-between border-b bg-transparent px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Monitor className="text-muted-copy h-3.5 w-3.5 shrink-0" />
          <span className="text-ink truncate text-[11px] font-semibold">
            {session.profileName}
          </span>
          <span className="text-subtle-copy shrink-0 font-mono text-[10px]">
            :{session.displayNum}
          </span>
        </div>
        <div className="text-status-success flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
          <span className="status-dot-success h-2 w-2 rounded-full" />
          active
        </div>
      </div>

      <div className="relative min-h-[200px] flex-1">
        {isMobile ? (
          <div className="bg-overlay text-muted-copy flex h-full items-center justify-center text-center text-xs">
            <div className="space-y-2 px-4">
              <Monitor className="text-subtle-copy mx-auto h-6 w-6" />
              <div>Open session to start the live display stream.</div>
            </div>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="bg-overlay h-full w-full animate-pulse" />
            }
          >
            <VncViewer
              url={buildVncWebSocketUrl(session.vncPort)}
              interactive={false}
              className="h-full w-full"
            />
          </Suspense>
        )}
        <div className="absolute right-2 bottom-2 rounded-[3px] bg-black/55 px-2 py-1 font-mono text-[10px] text-white/80 opacity-0 transition-opacity group-hover:opacity-100">
          {session.workflowId}
        </div>
      </div>
    </button>
  )
}


