import { isRouteErrorResponse, useRouteError } from 'react-router'
import { AlertTriangle } from 'lucide-react'

type RouteErrorViewProps = {
  title: string
}

export function RouteErrorView({ title }: RouteErrorViewProps) {
  const error = useRouteError()

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.'

  return (
    <div className="bg-shell text-ink flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-status-danger flex items-center gap-3">
        <AlertTriangle className="h-8 w-8" />
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>
      <p className="text-muted-copy max-w-lg text-sm">{message}</p>
    </div>
  )
}
