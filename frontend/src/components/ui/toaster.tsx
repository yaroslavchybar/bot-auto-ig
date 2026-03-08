import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
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
