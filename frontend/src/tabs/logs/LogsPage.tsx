import { lazy, Suspense } from 'react'
import { Terminal } from 'lucide-react'
import { AmbientGlow } from '@/components/ui/ambient-glow'

const LogsViewer = lazy(() =>
  import('@/components/LogsViewer').then((module) => ({
    default: module.LogsViewer,
  })),
)

export function LogsPage() {
  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />

      {/* Header */}
      <div className="mobile-effect-blur mobile-effect-sticky bg-panel-subtle border-line-soft sticky top-0 z-10 flex shrink-0 items-center justify-between border-b px-6 py-4 backdrop-blur-xs">
        <div>
          <h2 className="page-title-gradient flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Terminal className="text-copy h-5 w-5" />
            System Logs
          </h2>
          <p className="text-muted-copy text-sm">
            Monitor live and archival system operations.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
        <div className="bg-panel-subtle border-line-soft flex flex-1 flex-col overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs">
          <Suspense
            fallback={
              <div className="text-subtle-copy flex h-full items-center justify-center text-sm">
                Loading logs...
              </div>
            }
          >
            <LogsViewer className="h-full rounded-none border-none bg-transparent" />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
