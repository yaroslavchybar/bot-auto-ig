import { usePerformanceMode } from '@/hooks/use-performance-mode'
import { cn } from '@/lib/utils'

interface AmbientGlowProps {
  className?: string
  reducedClassName?: string
}

export function AmbientGlow({ className, reducedClassName }: AmbientGlowProps) {
  const performanceMode = usePerformanceMode()

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-full',
        performanceMode
          ? 'mobile-effect-glow ambient-glow-surface-reduced h-[220px] w-[min(92vw,520px)]'
          : 'mobile-effect-glow ambient-glow-surface h-[400px] w-[800px]',
        performanceMode ? reducedClassName : className,
      )}
    />
  )
}
