import { StrictMode, useMemo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/shared/ErrorBoundary.tsx'
import { getClerkAppearance } from './components/shared/clerk-appearance.ts'
import { ThemeProvider, useTheme } from './hooks/use-theme.tsx'
import { AmbientGlow } from './components/ui/ambient-glow.tsx'
import { usePerformanceMode } from './hooks/use-performance-mode.ts'
import { env } from './lib/env.ts'
import { cn } from './lib/utils.ts'

function AppFrame() {
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
        reducedClassName="w-[640px] h-[280px]"
      />
      <App />
    </div>
  )
}

function ClerkThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  const clerkAppearance = useMemo(() => getClerkAppearance(theme), [theme])

  return (
    <ClerkProvider
      publishableKey={env.clerkPublishableKey}
      appearance={clerkAppearance}
    >
      {children}
    </ClerkProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <ClerkThemeProvider>
          <AppFrame />
        </ClerkThemeProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)


