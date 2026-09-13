import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from '@/lib/router'
import { Code, Loader2, Send } from 'lucide-react'
import { AuthCardShell } from '@/components/shared/AuthCardShell'
import { Button } from '@/components/ui/button'
import { useAppAuth, type AppUser, type AuthConfig } from '@/lib/auth'
import {
  AUTH_ROUTES,
  REDIRECT_URL_PARAM,
  getSafeRedirectTarget,
} from '@/lib/auth-routing'

type AppLink = { token: string; bot: string; url: string }

const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 300

export function TelegramLoginPageContainer() {
  const { isLoaded, isSignedIn, authFetch, loginWithToken, devLogin } =
    useAppAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Deep-link login: token + links for the Telegram app jump.
  const [appLink, setAppLink] = useState<AppLink | null>(null)
  const [isWaitingApp, setIsWaitingApp] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const redirectTarget = getSafeRedirectTarget(
    searchParams.get(REDIRECT_URL_PARAM),
    typeof window === 'undefined' ? undefined : window.location.origin,
  )

  const stopAppPoll = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  useEffect(() => stopAppPoll, [])

  // Load auth config (bot username + availability).
  useEffect(() => {
    let cancelled = false
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
    }
  }, [authFetch])

  // App-open login: jump straight into the Telegram app (no browser tab).
  // The user taps START in the bot; the poll below picks up the confirmation.
  const handleAppLogin = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await authFetch('/api/auth/tg-link', { method: 'POST' })
      const data = (await res.json().catch(() => null)) as {
        token?: unknown
        bot?: unknown
        url?: unknown
        error?: unknown
      } | null
      if (
        !res.ok ||
        typeof data?.token !== 'string' ||
        typeof data?.bot !== 'string'
      ) {
        throw new Error(
          typeof data?.error === 'string' && data.error
            ? data.error
            : 'Telegram login is not available',
        )
      }
      const link: AppLink = {
        token: data.token,
        bot: data.bot,
        url:
          typeof data.url === 'string' && data.url
            ? data.url
            : `https://t.me/${data.bot}?start=${data.token}`,
      }
      setAppLink(link)
      setIsWaitingApp(true)
      // tg:// opens the native app directly; the t.me link below is the fallback.
      window.location.href = `tg://resolve?domain=${encodeURIComponent(link.bot)}&start=${encodeURIComponent(link.token)}`
      stopAppPoll()
      let attempts = 0
      pollTimerRef.current = setInterval(async () => {
        attempts++
        try {
          const poll = await authFetch(
            `/api/auth/tg-poll?token=${encodeURIComponent(link.token)}`,
          )
          const state = (await poll.json().catch(() => null)) as {
            user?: AppUser
            token?: unknown
            error?: unknown
          } | null
          if (poll.ok && state?.user && typeof state.token === 'string') {
            stopAppPoll()
            setIsWaitingApp(false)
            loginWithToken(state.user, state.token)
            navigate(redirectTarget, { replace: true })
            return
          }
          if (poll.status === 404 || poll.status === 403 || attempts > MAX_POLL_ATTEMPTS) {
            stopAppPoll()
            setIsWaitingApp(false)
            if (poll.status === 403) {
              setError(
                typeof state?.error === 'string' && state.error
                  ? state.error
                  : 'Login failed',
              )
            } else if (attempts > MAX_POLL_ATTEMPTS) {
              setError('Login timed out. Try again.')
            }
            setAppLink(null)
          }
        } catch {
          // Transient network blip: keep polling until the token expires.
        }
      }, POLL_INTERVAL_MS)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Telegram login failed',
      )
      setAppLink(null)
    } finally {
      setSubmitting(false)
    }
  }

  const cancelAppLogin = () => {
    stopAppPoll()
    setIsWaitingApp(false)
    setAppLink(null)
  }

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

          {config.isConfigured && !isWaitingApp && (
            <div className="flex flex-col items-center gap-3">
              <Button
                type="button"
                className="h-11 w-full justify-center rounded-xl bg-[#229ED9] text-sm font-semibold text-white hover:bg-[#1d8bc0]"
                disabled={submitting}
                onClick={handleAppLogin}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Continue with Telegram
              </Button>
              <p className="text-muted-copy text-center text-[11px]">
                Opens your Telegram app — tap START in the bot, no phone number
                needed.
              </p>
            </div>
          )}

          {config.isConfigured && isWaitingApp && appLink && (
            <div className="flex flex-col items-center gap-3">
              <div className="text-muted-copy flex items-center gap-2 text-xs">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for you to tap START in Telegram…
              </div>
              <a
                href={appLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[#229ED9] hover:underline"
              >
                Telegram didn&apos;t open? Click here instead.
              </a>
              <button
                type="button"
                onClick={cancelAppLogin}
                className="text-muted-copy text-[11px] underline transition hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Cancel
              </button>
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
              Only the admin Telegram account can sign in.
            </p>
          )}

        </>
      )}
    </AuthCardShell>
  )
}
