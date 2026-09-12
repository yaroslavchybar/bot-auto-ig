import { useEffect, useRef, type ReactNode } from 'react'
import { ListsPage } from '@/features/lists/ListsPage'
import { LogsPage } from '@/features/logs/LogsPage'
import { ProfilesPage } from '@/features/profiles/ProfilesPage'
import { ScrapedDataPage } from '@/features/scraped-data/ScrapedDataPage'
import { VncPage } from '@/features/vnc/VncPage'
import { VncSessionPage } from '@/features/vnc/VncSessionPage'
import { WorkflowEditorPage } from '@/features/workflows/WorkflowEditorPage'
import { WorkflowsPage } from '@/features/workflows/WorkflowsPage'
import { LoginPage } from '@/pages/LoginPage'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { ProtectedLayoutShell } from '@/components/layout/ProtectedLayoutShell'
import { ErrorBoundary as AppErrorBoundary } from '@/components/shared/ErrorBoundary'
import { ThemeProvider } from '@/hooks/use-theme'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { Toaster } from '@/components/ui/toaster'
import { usePerformanceMode } from '@/hooks/use-performance-mode'
import { AppAuthProvider } from '@/lib/auth'
import { addNavigationBreadcrumb } from '@/lib/sentry'
import { cn } from '@/lib/utils'
import {
  matchRoute,
  Navigate,
  RouterProvider,
  useLocation,
  type RouteMeta,
} from '@/lib/router'

function AppFrame({ children }: { children: ReactNode }) {
  const performanceMode = usePerformanceMode()

  return (
    <div
      className={cn(
        'bg-shell text-ink relative min-h-screen font-sans',
        performanceMode && 'performance-mode',
      )}
    >
      <AmbientGlow
        className="h-[500px] w-[1000px]"
        reducedClassName="h-[280px] w-[640px]"
      />
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

  if (pathname === '/') {
    return <Navigate to="/profiles" replace />
  }

  if (pathname === '/login') {
    return <LoginPage />
  }

  const match = matchRoute(pathname)
  if (!match?.meta) {
    return <NotFoundView />
  }

  const { pattern, meta } = match

  switch (pattern) {
    case '/profiles':
      return (
        <ProtectedRoute meta={meta} pathname={pathname}>
          <ProfilesPage />
        </ProtectedRoute>
      )
    case '/workflows':
      return (
        <ProtectedRoute meta={meta} pathname={pathname}>
          <WorkflowsPage />
        </ProtectedRoute>
      )
    case '/workflows/:workflowId/editor':
      return (
        <ProtectedRoute meta={meta} pathname={pathname}>
          <WorkflowEditorPage />
        </ProtectedRoute>
      )
    case '/scraped-data':
      return (
        <ProtectedRoute meta={meta} pathname={pathname}>
          <ScrapedDataPage />
        </ProtectedRoute>
      )
    case '/lists':
      return (
        <ProtectedRoute meta={meta} pathname={pathname}>
          <ListsPage />
        </ProtectedRoute>
      )
    case '/logs':
      return (
        <ProtectedRoute meta={meta} pathname={pathname}>
          <LogsPage />
        </ProtectedRoute>
      )
    case '/vnc':
      return (
        <ProtectedRoute meta={meta} pathname={pathname}>
          <VncPage />
        </ProtectedRoute>
      )
    case '/vnc/session/:workflowId/:profileName':
      return (
        <ProtectedRoute meta={meta} pathname={pathname}>
          <VncSessionPage />
        </ProtectedRoute>
      )
    default:
      return <NotFoundView />
  }
}

export default function App() {
  return (
    <RouterProvider>
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
