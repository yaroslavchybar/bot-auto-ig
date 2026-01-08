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
                    background: '#18181b',
                    border: '1px solid #27272a',
                    color: '#fafafa',
                },
            }}
        />
    )
}
