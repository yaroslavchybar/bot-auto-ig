import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'
import { ConvexClientProvider } from './components/ConvexClientProvider.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { Toaster } from './components/ui/toaster.tsx'
import { clerkAppearance } from './components/clerk-appearance.ts'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        appearance={clerkAppearance}
      >
        <ConvexClientProvider>
          <div className="relative min-h-screen bg-[#050505] text-gray-200 font-sans selection:bg-red-500/30">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-red-600/10 blur-[120px] rounded-full pointer-events-none" />
            <App />
            <Toaster />
          </div>
        </ConvexClientProvider>
      </ClerkProvider>
    </ErrorBoundary>
  </StrictMode>,
)

