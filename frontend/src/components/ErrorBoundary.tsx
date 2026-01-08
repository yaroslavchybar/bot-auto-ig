import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

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
                <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 bg-background">
                    <div className="flex items-center gap-3 text-destructive">
                        <AlertTriangle className="w-10 h-10" />
                        <h1 className="text-2xl font-bold">Something went wrong</h1>
                    </div>

                    <p className="text-muted-foreground text-center max-w-md">
                        An unexpected error occurred. You can try reloading the page or go back.
                    </p>

                    {this.state.error && (
                        <pre className="text-sm text-destructive bg-destructive/10 p-4 rounded-md max-w-lg overflow-auto">
                            {this.state.error.message}
                        </pre>
                    )}

                    <div className="flex gap-3">
                        <Button variant="outline" onClick={this.handleReset}>
                            Try Again
                        </Button>
                        <Button onClick={this.handleReload}>
                            Reload Page
                        </Button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
