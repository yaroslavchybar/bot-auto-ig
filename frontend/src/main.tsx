import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'
import { ConvexClientProvider } from './components/ConvexClientProvider.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { Toaster } from './components/ui/toaster.tsx'
import { clerkAppearance } from './components/clerk-appearance.ts'
import { AmbientGlow } from './components/ui/ambient-glow.tsx'
import { usePerformanceMode } from './hooks/use-performance-mode.ts'
import { cn } from './lib/utils.ts'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable')
}

function AppFrame() {
  const performanceMode = usePerformanceMode()

  return (
    <div
      className={cn(
        'relative min-h-screen bg-[#050505] text-gray-200 font-sans selection:bg-red-500/30',
        performanceMode && 'performance-mode'
      )}
    >
      <AmbientGlow className="w-[1000px] h-[500px]" reducedClassName="w-[640px] h-[280px]" />
      <App />
      <Toaster />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        appearance={clerkAppearance}
      >
        <ConvexClientProvider>
          <AppFrame />
        </ConvexClientProvider>
      </ClerkProvider>
    </ErrorBoundary>
  </StrictMode>,
)

