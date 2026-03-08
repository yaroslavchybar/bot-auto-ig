import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { clerkAppearance } from './components/clerk-appearance.ts'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={env.clerkPublishableKey}
        appearance={clerkAppearance}
      >
        <AppFrame />
      </ClerkProvider>
    </ErrorBoundary>
  </StrictMode>,
)
