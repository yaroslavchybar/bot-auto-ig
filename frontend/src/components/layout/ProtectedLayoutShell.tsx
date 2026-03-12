import { Activity, useEffect, type ReactNode } from 'react'
import {
  useLocation,
  useMatches,
  useNavigation,
  useOutlet,
} from 'react-router'
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react'
import { UserMenu } from '@/components/layout/user-menu'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import {
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar'
import {
  AppSidebar,
  type NavId,
} from '@/components/layout/app-sidebar'
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch'
import { ConvexClientProvider } from '@/components/layout/ConvexClientProvider'
import { Toaster } from '@/components/ui/toaster'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'

const KEEP_ALIVE_PATHS = new Set(['/workflows', '/accounts', '/logs', '/vnc'])
const keepAliveCache = new Map<string, ReactNode>()

type ProtectedLayoutShellProps = {
  sidebarDefaultOpen?: boolean
}

type RouteHandle = {
  breadcrumb?: string
  navId?: NavId
  appChrome?: 'default' | 'immersive'
}

function KeepAliveViewport({
  pathname,
  outlet,
}: {
  pathname: string
  outlet: ReactNode
}) {
  useEffect(() => {
    if (!KEEP_ALIVE_PATHS.has(pathname) || !outlet || keepAliveCache.has(pathname)) {
      return
    }

    keepAliveCache.set(pathname, outlet)
  }, [pathname, outlet])

  const activeHeavyRoute = keepAliveCache.get(pathname)

  return (
    <>
      {Array.from(keepAliveCache.entries()).map(([routePath, element]) => (
        <Activity
          key={routePath}
          mode={pathname === routePath ? 'visible' : 'hidden'}
        >
          {element}
        </Activity>
      ))}
      {KEEP_ALIVE_PATHS.has(pathname) ? (!activeHeavyRoute ? outlet : null) : outlet}
    </>
  )
}

function ConvexAuthGate({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <div className="bg-shell text-ink flex h-svh items-center justify-center text-sm">
          Connecting data session...
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="bg-shell text-ink flex h-svh items-center justify-center px-6 text-center">
          <div className="max-w-md space-y-2">
            <h2 className="text-lg font-semibold">Convex authentication failed</h2>
            <p className="text-muted-copy text-sm">
              Check Clerk JWT template `convex` and Convex env
              `CLERK_JWT_ISSUER_DOMAIN`.
            </p>
          </div>
        </div>
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  )
}

export function ProtectedLayoutShell({
  sidebarDefaultOpen = true,
}: ProtectedLayoutShellProps) {
  const location = useLocation()
  const matches = useMatches()
  const navigation = useNavigation()
  const outlet = useOutlet()

  useAuthenticatedFetch()

  const activeMatch = [...matches].reverse().find((match) => {
    const handle = match.handle as RouteHandle | undefined
    return Boolean(handle?.breadcrumb)
  })
  const activeHandle = activeMatch?.handle as RouteHandle | undefined
  const breadcrumb = activeHandle?.breadcrumb ?? 'Profiles Manager'
  const currentPath = location.pathname
  const appChrome = activeHandle?.appChrome ?? 'default'

  if (appChrome === 'immersive') {
    return (
      <ConvexClientProvider>
        <ConvexAuthGate>
          <div className="bg-shell flex h-svh min-w-0 flex-col overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1">
              <KeepAliveViewport pathname={currentPath} outlet={outlet} />
            </div>
          </div>
        </ConvexAuthGate>
        <Toaster />
      </ConvexClientProvider>
    )
  }

  return (
    <ConvexClientProvider>
      <ConvexAuthGate>
        <SidebarProvider
          defaultOpen={sidebarDefaultOpen}
          className="h-svh min-w-0 overflow-hidden"
        >
          <AppSidebar />
          <SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-transparent">
            <header className="border-line-soft bg-panel-subtle relative z-10 flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
              <div className="flex min-w-0 items-center gap-2 px-4">
                <Breadcrumb className="min-w-0">
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbPage className="page-title-gradient text-lg font-medium">
                        {breadcrumb}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              <div className="ml-auto flex items-center gap-2 px-4">
                {navigation.state !== 'idle' ? (
                  <div className="bg-brand/15 text-brand rounded-full px-3 py-1 text-xs font-medium">
                    {navigation.state === 'loading' ? 'Loading...' : 'Saving...'}
                  </div>
                ) : null}
                <ThemeToggle />
                <UserMenu />
              </div>
            </header>
            <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-0">
              <div className="min-h-0 min-w-0 flex-1">
                <KeepAliveViewport pathname={currentPath} outlet={outlet} />
              </div>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </ConvexAuthGate>
      <Toaster />
    </ConvexClientProvider>
  )
}
