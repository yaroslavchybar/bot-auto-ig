import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Code, Loader2, Send } from 'lucide-react'
import { AuthCardShell } from '@/components/shared/AuthCardShell'
import { Button } from '@/components/ui/button'
import { useAppAuth, type AuthConfig } from '@/lib/auth'
import {
  AUTH_ROUTES,
  REDIRECT_URL_PARAM,
  getSafeRedirectTarget,
} from '@/lib/auth-routing'

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void
  }
}

const WIDGET_SCRIPT_SRC = 'https://telegram.org/js/telegram-widget.js?22'

export function TelegramLoginPageContainer() {
  const { isLoaded, isSignedIn, authFetch, loginWithTelegram, devLogin } =
    useAppAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const widgetRef = useRef<HTMLDivElement>(null)

  const redirectTarget = getSafeRedirectTarget(
    searchParams.get(REDIRECT_URL_PARAM),
    typeof window === 'undefined' ? undefined : window.location.origin,
  )

  const handleTelegramAuth = useCallback(
    async (payload: Record<string, unknown>) => {
      setSubmitting(true)
      setError(null)
      try {
        await loginWithTelegram(payload)
        navigate(redirectTarget, { replace: true })
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Telegram login failed',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [loginWithTelegram, navigate, redirectTarget],
  )

  // Load auth config, then render the Telegram Login Widget into the slot.
  useEffect(() => {
    let cancelled = false
    window.onTelegramAuth = (user) => void handleTelegramAuth(user)

    ;(async () => {
      try {
        const res = await authFetch('/api/auth/config')
        const data = (await res.json()) as AuthConfig
        if (!cancelled) setConfig(data)
      } catch {
        if (!cancelled) {
          setConfig({ botUsername: '', isConfigured: false, isDevLoginEnabled: false })
        }
      }
    })()

    return () => {
      cancelled = true
      delete window.onTelegramAuth
    }
  }, [authFetch, handleTelegramAuth])

  useEffect(() => {
    if (!config?.isConfigured || !config.botUsername || !widgetRef.current) return
    if (widgetRef.current.childElementCount > 0) return

    const script = document.createElement('script')
    script.src = WIDGET_SCRIPT_SRC
    script.async = true
    script.setAttribute('data-telegram-login', config.botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    widgetRef.current.appendChild(script)
  }, [config])

  const handleDevLogin = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await devLogin()
      navigate(redirectTarget, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dev login failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoaded && isSignedIn) {
    return <Navigate to={AUTH_ROUTES.signedInFallback} replace />
  }

  return (
    <AuthCardShell
      title="Admin Sign-In"
      description="Authenticate with Telegram to access the dashboard."
      error={error}
    >
      {config === null ? (
        <div className="text-muted-copy flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading login options...
        </div>
      ) : (
        <>
          {!config.isConfigured && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <p className="font-semibold">Telegram login is not configured</p>
              <p className="mt-1 leading-relaxed">
                Set <code className="font-mono">TELEGRAM_BOT_TOKEN</code>,{' '}
                <code className="font-mono">TELEGRAM_BOT_USERNAME</code> and{' '}
                <code className="font-mono">TELEGRAM_ADMIN_ID</code> on the
                server, then reload.
              </p>
            </div>
          )}

          {config.isConfigured && (
            <div className="flex flex-col items-center gap-3">
              <div ref={widgetRef} className="flex justify-center" />
              {submitting && (
                <div className="text-muted-copy flex items-center gap-2 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying credentials...
                </div>
              )}
              <p className="text-muted-copy text-center text-[11px]">
                Only the admin Telegram account can sign in.
              </p>
            </div>
          )}

          {config.isDevLoginEnabled && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full justify-center rounded-xl text-sm font-medium"
              disabled={submitting}
              onClick={handleDevLogin}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Code className="h-4 w-4" />
              )}
              Dev login as admin
            </Button>
          )}

          {config.isConfigured && (
            <p className="text-muted-copy flex items-center justify-center gap-1.5 text-[11px]">
              <Send className="h-3.5 w-3.5" />
              Login widget works on the registered domain only — use dev login
              on localhost.
            </p>
          )}

        </>
      )}
    </AuthCardShell>
  )
}
