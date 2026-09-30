import { captureException } from '@/lib/sentry'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, {
      contexts: { react: { componentStack: info.componentStack ?? undefined } },
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle className="h-10 w-10" />
            <h1 className="text-2xl font-bold">Something went wrong</h1>
          </div>

          <p className="max-w-md text-center text-muted-foreground">
            An unexpected error occurred. You can try reloading the page or go back.
          </p>

          {this.state.error && (
            <pre className="max-w-lg overflow-auto rounded-md bg-destructive/10 p-4 text-sm text-destructive">
              {this.state.error.message}
            </pre>
          )}

          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={this.handleReset}>
              Try Again
            </Button>
            <Button type="button" onClick={this.handleReload}>
              Reload Page
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
