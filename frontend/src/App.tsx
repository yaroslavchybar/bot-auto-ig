import { useEffect, useRef, type ReactNode } from 'react'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { ProtectedLayoutShell } from '@/components/layout/ProtectedLayoutShell'
import { ErrorBoundary as AppErrorBoundary } from '@/components/shared/ErrorBoundary'
import { ThemeProvider } from '@/hooks/use-theme'
import { Toaster } from '@/components/ui/toaster'
import { usePerformanceMode } from '@/hooks/use-performance-mode'
import { AppAuthProvider } from '@/lib/auth'
import { addNavigationBreadcrumb } from '@/lib/sentry'
import { cn } from '@/lib/utils'
import {
  matchRoute,
  RouterProvider,
  useLocation,
} from '@/lib/router'
import { ROUTE_META, type RouteMeta } from '@/lib/routes'

function AppFrame({ children }: { children: ReactNode }) {
  const performanceMode = usePerformanceMode()

  return (
    <div
      className={cn(
        'bg-shell text-ink relative min-h-screen font-sans',
        performanceMode && 'performance-mode',
      )}
    >
      {children}
    </div>
  )
}

function ProtectedRoute({
  meta,
  pathname,
  children,
}: {
  meta: RouteMeta
  pathname: string
  children: ReactNode
}) {
  return (
    <AuthGuard>
      <ProtectedLayoutShell routeMeta={meta} pathname={pathname}>
        {children}
      </ProtectedLayoutShell>
    </AuthGuard>
  )
}

function NotFoundView() {
  return (
    <div className="bg-shell text-ink flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-copy text-sm">
        The page you are looking for does not exist.
      </p>
      <a href="/profiles" className="brand-link text-sm font-medium">
        Go to Profiles Manager
      </a>
    </div>
  )
}

function Routes() {
  const { pathname } = useLocation()
  const prevPathRef = useRef(pathname)

  useEffect(() => {
    const prev = prevPathRef.current
    if (prev !== pathname) {
      addNavigationBreadcrumb(prev, pathname)
      prevPathRef.current = pathname
    }
  }, [pathname])

  // Note: '/' is canonicalized to '/profiles' in readLocation, so no
  // redirect handling is needed here.
  const match = matchRoute(pathname, ROUTE_META)
  if (!match?.meta) {
    return <NotFoundView />
  }

  const { meta } = match
  const Page = meta.Page
  if (match.pattern === '/login') return <Page />
  return <ProtectedRoute meta={meta} pathname={pathname}><Page /></ProtectedRoute>

}

export default function App() {
  return (
    <RouterProvider routes={ROUTE_META}>
      <ThemeProvider>
        <AppErrorBoundary>
          <AppAuthProvider>
            <AppFrame>
              <Routes />
            </AppFrame>
            <Toaster />
          </AppAuthProvider>
        </AppErrorBoundary>
      </ThemeProvider>
    </RouterProvider>
  )
}
