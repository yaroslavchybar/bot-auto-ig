import { AmbientGlow } from '@/components/ui/ambient-glow'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function MonitoringSkeleton() {
  return (
    <div className="bg-shell text-ink relative flex h-full flex-col overflow-hidden">
      <AmbientGlow />
      <SkeletonHeader />
      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <SkeletonMetricCard key={item} />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {[1, 2].map((item) => (
              <SkeletonSectionCard key={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SkeletonHeader() {
  return (
    <div className="mobile-effect-blur border-line-soft bg-panel-subtle sticky top-0 z-10 shrink-0 border-b px-4 pt-2 pb-2 backdrop-blur-xs md:px-6 md:pt-3 md:pb-3">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="bg-panel-hover h-8 w-48" />
            <Skeleton className="bg-panel-hover h-4 w-72 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="bg-panel-hover h-7 w-20 rounded-full" />
            <Skeleton className="bg-panel-hover h-7 w-32 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

function SkeletonMetricCard() {
  return (
    <Card className="border-line-soft bg-panel-subtle rounded-2xl border shadow-xs backdrop-blur-xs">
      <CardHeader className="gap-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="bg-panel-hover h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="bg-panel-hover h-4 w-24" />
              <Skeleton className="bg-panel-hover h-3 w-20" />
            </div>
          </div>
          <Skeleton className="bg-panel-hover h-6 w-20 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <Skeleton className="bg-panel-hover h-10 w-20" />
        <Skeleton className="bg-panel-hover h-2.5 w-full rounded-full" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((stat) => (
            <Skeleton key={stat} className="bg-panel-hover h-[72px] rounded-xl" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function SkeletonSectionCard() {
  return (
    <Card className="border-line-soft bg-panel-subtle rounded-2xl border shadow-xs backdrop-blur-xs">
      <CardHeader className="border-line-soft gap-3 border-b pb-4">
        <div className="flex items-start gap-3">
          <Skeleton className="bg-panel-hover h-10 w-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="bg-panel-hover h-4 w-32" />
            <Skeleton className="bg-panel-hover h-4 w-48" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-5">
        {[1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="bg-panel-hover h-12 rounded-xl" />
        ))}
      </CardContent>
    </Card>
  )
}
