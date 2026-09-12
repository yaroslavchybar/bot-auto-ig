import { Activity, type ReactNode } from 'react'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { UserMenu } from '@/components/layout/user-menu'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch'
import { ConvexClientProvider } from '@/components/layout/ConvexClientProvider'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { parseSidebarOpen } from '@/lib/sidebar-state'
import type { RouteMeta } from '@/lib/router'

const KEEP_ALIVE_PATHS = new Set(['/workflows', '/accounts', '/logs', '/vnc'])
const keepAliveCache = new Map<string, ReactNode>()

type ProtectedLayoutShellProps = {
  routeMeta: RouteMeta
  pathname: string
  children: ReactNode
}

function KeepAliveViewport({
  pathname,
  children,
}: {
  pathname: string
  children: ReactNode
}) {
  // Cache on first render so the route mounts inside its stable Activity
  // immediately — caching in an effect would first mount it outside, then
  // remount inside, losing local state. The set is idempotent, so double
  // renders just keep the first element.
  if (KEEP_ALIVE_PATHS.has(pathname) && children && !keepAliveCache.has(pathname)) {
    keepAliveCache.set(pathname, children)
  }

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
      {KEEP_ALIVE_PATHS.has(pathname) ? null : children}
    </>
  )
}

function SessionGate({ children }: { children: ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}

function readSidebarDefaultOpen() {
  if (typeof document === 'undefined') return true
  return parseSidebarOpen(document.cookie)
}

export function ProtectedLayoutShell({
  routeMeta,
  pathname,
  children,
}: ProtectedLayoutShellProps) {
  useAuthenticatedFetch()

  const breadcrumb = routeMeta.breadcrumb ?? 'Profiles Manager'
  const appChrome = routeMeta.appChrome ?? 'default'

  if (appChrome === 'immersive') {
    return (
      <ConvexClientProvider>
        <SessionGate>
          <div className="bg-shell flex h-svh min-w-0 flex-col overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1">
              <KeepAliveViewport pathname={pathname}>
                {children}
              </KeepAliveViewport>
            </div>
          </div>
        </SessionGate>
      </ConvexClientProvider>
    )
  }

  return (
    <ConvexClientProvider>
      <SessionGate>
        <SidebarProvider
          defaultOpen={readSidebarDefaultOpen()}
          className="h-svh min-w-0 overflow-hidden"
        >
          <AppSidebar />
          <SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-transparent">
            <header className="border-line-soft bg-panel-subtle relative z-10 flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
              <div className="flex min-w-0 items-center gap-2 px-4">
                <SidebarTrigger className="text-muted-copy hover:text-ink -ml-1 size-8 md:hidden" />
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
                <ThemeToggle />
                <UserMenu />
              </div>
            </header>
            <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-0">
              <div className="min-h-0 min-w-0 flex-1">
                <KeepAliveViewport pathname={pathname}>
                  {children}
                </KeepAliveViewport>
              </div>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </SessionGate>
    </ConvexClientProvider>
  )
}
