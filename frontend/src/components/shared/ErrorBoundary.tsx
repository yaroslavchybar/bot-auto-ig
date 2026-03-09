import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

const actionButtonClassName =
  'inline-flex h-9 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack)
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
        <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-6 p-8">
          <div className="text-destructive flex items-center gap-3">
            <AlertTriangle className="h-10 w-10" />
            <h1 className="text-2xl font-bold">Something went wrong</h1>
          </div>

          <p className="text-muted-foreground max-w-md text-center">
            An unexpected error occurred. You can try reloading the page or go
            back.
          </p>

          {this.state.error && (
            <pre className="text-destructive bg-destructive/10 max-w-lg overflow-auto rounded-md p-4 text-sm">
              {this.state.error.message}
            </pre>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              className={cn(
                actionButtonClassName,
                'border-input bg-background hover:bg-accent hover:text-accent-foreground border shadow-xs',
              )}
              onClick={this.handleReset}
            >
              Try Again
            </button>
            <button
              type="button"
              className={cn(
                actionButtonClassName,
                'bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs',
              )}
              onClick={this.handleReload}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}


