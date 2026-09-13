import type { ReactNode } from 'react'
import { UserMenu } from '@/components/layout/user-menu'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ConvexClientProvider } from '@/components/layout/ConvexClientProvider'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { parseSidebarOpen } from '@/lib/sidebar-state'
import type { RouteMeta } from '@/lib/router'

type ProtectedLayoutShellProps = {
  routeMeta: RouteMeta
  pathname: string
  children: ReactNode
}

function readSidebarDefaultOpen() {
  if (typeof document === 'undefined') return true
  return parseSidebarOpen(document.cookie)
}

export function ProtectedLayoutShell({
  routeMeta,
  children,
}: ProtectedLayoutShellProps) {

  const breadcrumb = routeMeta.breadcrumb ?? 'Profiles Manager'
  const appChrome = routeMeta.appChrome ?? 'default'

  if (appChrome === 'immersive') {
    return (
      <ConvexClientProvider>
          <div className="bg-shell flex h-svh min-w-0 flex-col overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1">
              {children}
            </div>
          </div>
      </ConvexClientProvider>
    )
  }

  return (
    <ConvexClientProvider>
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
                {children}
              </div>
            </div>
          </SidebarInset>
        </SidebarProvider>
    </ConvexClientProvider>
  )
}
