import { RefreshCw } from 'lucide-react'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function FatalErrorState({
  error,
  onRetry,
  retrying,
}: {
  error: string
  onRetry: () => void
  retrying: boolean
}) {
  return (
    <div className="bg-shell relative flex h-full items-center justify-center p-4 md:p-6">
      <AmbientGlow />
      <Card className="border-line bg-panel relative z-10 w-full max-w-md rounded-2xl border shadow-xl backdrop-blur-xl">
        <CardContent className="space-y-6 p-6 text-center">
          <div className="border-status-danger-border bg-status-danger-soft mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border">
            <RefreshCw className="text-status-danger h-5 w-5" />
          </div>
          <div className="space-y-2">
            <h2 className="page-title-gradient text-2xl font-bold tracking-tight">
              Monitoring unavailable
            </h2>
            <p className="text-muted-copy text-sm">{error}</p>
          </div>
          <Button onClick={onRetry} disabled={retrying} className="brand-button w-full">
            <RefreshCw className={retrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
