import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { dark } from '@clerk/themes'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './components/theme-provider.tsx'
import { ConvexClientProvider } from './components/ConvexClientProvider.tsx'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: '#a855f7',
          colorBackground: '#0a0a0f',
          colorInputBackground: '#13131a',
          colorInputText: '#f4f4f5',
          colorText: '#f4f4f5',
          colorTextSecondary: '#a1a1aa',
          colorDanger: '#ef4444',
          borderRadius: '0.5rem',
        },
        elements: {
          card: 'bg-[#0a0a0f] border border-zinc-800 shadow-2xl',
          headerTitle: 'text-zinc-100 font-semibold',
          headerSubtitle: 'text-zinc-400',
          formButtonPrimary: 'bg-purple-600 hover:bg-purple-700 text-white font-medium',
          formFieldLabel: 'text-zinc-300',
          formFieldInput: 'bg-[#13131a] border-zinc-700 text-zinc-100 focus:border-purple-500 focus:ring-purple-500',
          footerActionLink: 'text-purple-400 hover:text-purple-300 font-medium',
          socialButtonsBlockButton: 'bg-[#13131a] border-zinc-700 text-zinc-100 hover:bg-zinc-800',
          dividerLine: 'bg-zinc-700',
          dividerText: 'text-zinc-500',
          identityPreview: 'bg-[#13131a] border-zinc-700',
          identityPreviewText: 'text-zinc-300',
          identityPreviewEditButton: 'text-purple-400 hover:text-purple-300',
          formFieldInputShowPasswordButton: 'text-zinc-400 hover:text-zinc-200',
          alertText: 'text-red-400',
          formFieldSuccessText: 'text-green-400',
          formFieldErrorText: 'text-red-400',
          footer: 'hidden',
        }
      }}
    >
      <ConvexClientProvider>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
          <App />
        </ThemeProvider>
      </ConvexClientProvider>
    </ClerkProvider>
  </StrictMode>,
)
