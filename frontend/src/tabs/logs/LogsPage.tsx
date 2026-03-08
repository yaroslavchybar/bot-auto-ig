import { lazy, Suspense } from 'react'
import { Terminal } from 'lucide-react'
import { AmbientGlow } from '@/components/ui/ambient-glow'

const LogsViewer = lazy(() => import('@/components/LogsViewer').then((module) => ({ default: module.LogsViewer })))

export function LogsPage() {
  return (
    <div className="flex flex-col h-full bg-[#050505] text-gray-200 animate-in fade-in duration-300 relative">
      <AmbientGlow />

      {/* Header */}
      <div className="mobile-effect-blur mobile-effect-sticky flex items-center justify-between px-6 py-4 border-b bg-white/[0.02] border-white/5 backdrop-blur-xs sticky top-0 z-10 shrink-0">
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
        <div className="flex-1 bg-white/[0.02] border border-white/[0.05] rounded-2xl backdrop-blur-xs shadow-xs overflow-hidden flex flex-col">
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-500">Loading logs...</div>}>
            <LogsViewer className="h-full bg-transparent border-none rounded-none" />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
