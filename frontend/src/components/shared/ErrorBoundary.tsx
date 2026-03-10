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


