import { lazy, Suspense } from 'react'
import { AmbientGlow } from '@/components/ui/ambient-glow'

const LogsViewer = lazy(() =>
  import('@/components/shared/LogsViewer').then((module) => ({
    default: module.LogsViewer,
  })),
)

export function LogsPage() {
  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />

      {/* Main Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
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


