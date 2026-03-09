import { ClerkProvider } from '@clerk/clerk-react'
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router'
import type { ReactNode } from 'react'
import './index.css'
import { getClerkAppearance } from '@/components/shared/clerk-appearance'
import { ErrorBoundary as AppErrorBoundary } from '@/components/shared/ErrorBoundary'
import { RouteErrorView } from '@/components/shared/RouteErrorView'
import { ThemeProvider, useTheme } from '@/hooks/use-theme'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { usePerformanceMode } from '@/hooks/use-performance-mode'
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

function ClerkThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  const clerkAppearance = getClerkAppearance(theme)

  return (
    <ClerkProvider
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

export default function Root() {
  return (
    <ThemeProvider>
      <AppErrorBoundary>
        <ClerkThemeProvider>
          <AppFrame>
            <Outlet />
          </AppFrame>
        </ClerkThemeProvider>
      </AppErrorBoundary>
    </ThemeProvider>
  )
}

export function ErrorBoundary() {
  return <RouteErrorView title="Application Error" />
}
