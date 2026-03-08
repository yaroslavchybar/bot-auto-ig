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
        'pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-full',
        performanceMode
          ? 'mobile-effect-glow h-[260px] w-[520px] opacity-80 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.18),rgba(234,88,12,0.10)_45%,transparent_72%)]'
          : 'mobile-effect-glow h-[400px] w-[800px] bg-red-600/10 blur-[120px]',
        performanceMode ? reducedClassName : className
      )}
    />
  )
}
