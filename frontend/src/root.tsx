import { ClerkProvider } from '@clerk/react-router'
import {
  clerkMiddleware,
  rootAuthLoader,
} from '@clerk/react-router/server'
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router'
import type { ReactNode } from 'react'
import type { Route } from './+types/root'
import './index.css'
import { getClerkAppearance } from '@/components/shared/clerk-appearance'
import { ErrorBoundary as AppErrorBoundary } from '@/components/shared/ErrorBoundary'
import { RouteErrorView } from '@/components/shared/RouteErrorView'
import { ThemeProvider, useTheme } from '@/hooks/use-theme'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { usePerformanceMode } from '@/hooks/use-performance-mode'
import { AUTH_ROUTES } from '@/lib/auth-routing'
import { env } from '@/lib/env'
import { cn } from '@/lib/utils'

function themeBootstrapScript() {
  return `
    (() => {
      const storageKey = 'anti-theme';
      const defaultTheme = 'dark';
      try {
        const storedTheme = window.localStorage.getItem(storageKey);
        const theme = storedTheme === 'light' ? 'light' : defaultTheme;
        const root = document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
      } catch {
        document.documentElement.classList.add('dark');
        document.documentElement.dataset.theme = defaultTheme;
        document.documentElement.style.colorScheme = defaultTheme;
      }
    })();
  `
}

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

export const middleware: Route.MiddlewareFunction[] = [
  clerkMiddleware({
    signInUrl: AUTH_ROUTES.signIn,
    signUpUrl: AUTH_ROUTES.signUp,
  }),
]

export function loader(args: Route.LoaderArgs) {
  return rootAuthLoader(args, {
    signInUrl: AUTH_ROUTES.signIn,
    signUpUrl: AUTH_ROUTES.signUp,
  })
}

function RootProviders({
  children,
  loaderData,
}: {
  children: ReactNode
  loaderData: Route.ComponentProps['loaderData']
}) {
  const { theme } = useTheme()
  const clerkAppearance = getClerkAppearance(theme)

  return (
    <ClerkProvider
      loaderData={loaderData}
      publishableKey={env.clerkPublishableKey}
      appearance={clerkAppearance}
    >
      {children}
    </ClerkProvider>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript() }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export function HydrateFallback() {
  return (
    <div className="bg-shell text-ink flex min-h-screen items-center justify-center text-sm">
      Loading...
    </div>
  )
}

export default function Root({ loaderData }: Route.ComponentProps) {
  return (
    <ThemeProvider>
      <AppErrorBoundary>
        <RootProviders loaderData={loaderData}>
          <AppFrame>
            <Outlet />
          </AppFrame>
        </RootProviders>
      </AppErrorBoundary>
    </ThemeProvider>
  )
}

export function ErrorBoundary() {
  return <RouteErrorView title="Application Error" />
}
