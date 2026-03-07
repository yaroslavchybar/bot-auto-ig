import { LogsViewer } from '@/components/LogsViewer'
import { Terminal } from 'lucide-react'

export function LogsPage() {
  return (
    <div className="flex flex-col h-full bg-[#050505] text-gray-200 animate-in fade-in duration-300 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-red-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white/[0.02] border-white/5 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <div>
          <h2 className="text-xl font-semibold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent flex items-center gap-2">
            <Terminal className="h-5 w-5 text-gray-300" />
            System Logs
          </h2>
          <p className="text-sm text-gray-400">Monitor live and archival system operations.</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6 flex flex-col min-h-0">
        <div className="flex-1 bg-white/[0.02] border border-white/[0.05] rounded-2xl backdrop-blur-sm shadow-sm overflow-hidden flex flex-col">
          <LogsViewer className="h-full bg-transparent border-none rounded-none" />
        </div>
      </div>
    </div>
  )
}
