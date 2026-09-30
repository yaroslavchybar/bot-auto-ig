import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { AuthGuard } from '@/components/layout/AuthGuard'
const ProtectedLayoutShell = lazy(() =>
  import('@/components/layout/ProtectedLayoutShell').then((module) => ({
    default: module.ProtectedLayoutShell,
  })),
)
import { ErrorBoundary as AppErrorBoundary } from '@/components/shared/ErrorBoundary'
import { ThemeProvider } from '@/hooks/use-theme'
import { Toaster } from '@/components/ui/toaster'
import { AppAuthProvider } from '@/lib/auth'
import { addNavigationBreadcrumb } from '@/lib/sentry'
import { matchRoute, RouterProvider, useLocation } from '@/lib/router'
import { ROUTE_META, type RouteMeta } from '@/lib/routes'

function AppFrame({ children }: { children: ReactNode }) {
  return <div className="relative min-h-screen bg-shell font-sans text-ink">{children}</div>
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
      <Suspense fallback={null}>
        <ProtectedLayoutShell routeMeta={meta} pathname={pathname}>
          {children}
        </ProtectedLayoutShell>
      </Suspense>
    </AuthGuard>
  )
}

function NotFoundView() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-shell px-6 text-center text-ink">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-copy">The page you are looking for does not exist.</p>
      <a href="/profiles" className="text-sm font-medium brand-link">
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

  // Bootstrap and navigation canonicalize '/' before rendering.
  const match = matchRoute(pathname, ROUTE_META)
  if (!match?.meta) {
    return <NotFoundView />
  }

  const { meta } = match
  const Page = meta.Page
  const page = (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  )
  if (match.pattern === '/login') return page
  return (
    <ProtectedRoute meta={meta} pathname={pathname}>
      {page}
    </ProtectedRoute>
  )
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
