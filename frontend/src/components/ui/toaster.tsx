import { Toaster as SonnerToaster } from 'sonner'
import { useTheme } from '@/hooks/use-theme'

export function Toaster() {
  const { theme } = useTheme()

  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        style: {
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          color: 'var(--ink)',
        },
      }}
    />
  )
}
