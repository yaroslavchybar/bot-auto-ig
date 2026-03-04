import { Monitor } from 'lucide-react'
import { VncViewer } from '@/components/VncViewer'

export type DisplaySession = {
  workflowId: string
  profileName: string
  vncPort: number
  displayNum: number
  status: 'active'
}

function getVncUrl(vncPort: number): string {
  if (typeof window === 'undefined') return `http://localhost:${vncPort}/vnc.html`
  return `${window.location.protocol}//${window.location.hostname}:${vncPort}/vnc.html`
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
      className="group text-left flex flex-col min-h-[250px] bg-black border border-neutral-300 dark:border-neutral-700 rounded-[4px] overflow-hidden shadow-sm hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors"
    >
      <div className="h-8 px-2.5 flex items-center justify-between bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor className="h-3.5 w-3.5 text-neutral-600 dark:text-neutral-300 shrink-0" />
          <span className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 truncate">
            {session.profileName}
          </span>
          <span className="text-[10px] text-neutral-500 font-mono shrink-0">:{session.displayNum}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-mono shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          active
        </div>
      </div>

      <div className="relative flex-1 min-h-[200px]">
        <VncViewer url={getVncUrl(session.vncPort)} interactive={false} className="w-full h-full" />
        <div className="absolute bottom-2 right-2 px-2 py-1 rounded-[3px] bg-black/55 text-[10px] text-white/80 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
          {session.workflowId}
        </div>
      </div>
    </button>
  )
}
