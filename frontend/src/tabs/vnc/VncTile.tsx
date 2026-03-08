import { Monitor } from 'lucide-react'
import { buildVncWebSocketUrl, VncViewer } from '@/components/VncViewer'

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
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group text-left flex flex-col min-h-[250px] bg-white/[0.02] border border-white/5 rounded-[4px] overflow-hidden backdrop-blur-sm shadow-sm hover:bg-white/[0.04] hover:border-white/10 transition-colors"
    >
      <div className="h-8 px-2.5 flex items-center justify-between bg-transparent border-b border-white/[0.05]">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <span className="text-[11px] font-semibold text-gray-200 truncate">
            {session.profileName}
          </span>
          <span className="text-[10px] text-gray-500 font-mono shrink-0">:{session.displayNum}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-green-400 font-mono shrink-0">
          <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]" />
          active
        </div>
      </div>

      <div className="relative flex-1 min-h-[200px]">
        <VncViewer url={buildVncWebSocketUrl(session.vncPort)} interactive={false} className="w-full h-full" />
        <div className="absolute bottom-2 right-2 px-2 py-1 rounded-[3px] bg-black/55 text-[10px] text-white/80 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
          {session.workflowId}
        </div>
      </div>
    </button>
  )
}
