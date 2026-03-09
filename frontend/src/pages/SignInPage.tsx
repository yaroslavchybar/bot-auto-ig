import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth, useSignIn } from '@clerk/clerk-react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { DenseButton } from '@/components/ui/dense-button'
import { Input } from '@/components/ui/input'
import { getClerkErrorMessage } from '@/lib/clerk-errors'

type SignInStep = 'credentials' | 'secondFactorEmailCode'

export function SignInPage() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth()
  const { isLoaded: isSignInLoaded, signIn, setActive } = useSignIn()
  const navigate = useNavigate()

  const [step, setStep] = useState<SignInStep>('credentials')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = submitting || !isAuthLoaded || !isSignInLoaded

  const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isSignInLoaded) return

    setSubmitting(true)
    setError(null)

    try {
      const signInAttempt = await signIn.create({
        identifier: identifier.trim(),
        password,
      })

      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId })
        navigate('/', { replace: true })
        return
      }

      if (signInAttempt.status === 'needs_second_factor') {
        const emailCodeFactor = signInAttempt.supportedSecondFactors?.find(
          (factor) =>
            factor.strategy === 'email_code' && 'emailAddressId' in factor,
        )

        if (
          emailCodeFactor &&
          typeof emailCodeFactor.emailAddressId === 'string'
        ) {
          await signIn.prepareSecondFactor({
            strategy: 'email_code',
            emailAddressId: emailCodeFactor.emailAddressId,
          })
          setStep('secondFactorEmailCode')
          return
        }

        setError(
          'A second factor is required, but email code verification is not available for this account.',
        )
        return
      }

      setError(
        `Unable to complete sign-in. Clerk status: ${signInAttempt.status}.`,
      )
    } catch (cause) {
      setError(
        getClerkErrorMessage(
          cause,
          'Sign-in failed. Check your credentials and try again.',
        ),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const submitSecondFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isSignInLoaded) return

    setSubmitting(true)
    setError(null)

    try {
      const signInAttempt = await signIn.attemptSecondFactor({
        strategy: 'email_code',
        code: code.trim(),
      })

      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId })
        navigate('/', { replace: true })
        return
      }

      setError(
        `Verification did not complete. Clerk status: ${signInAttempt.status}.`,
      )
    } catch (cause) {
      setError(
        getClerkErrorMessage(
          cause,
          'Verification failed. Check the code and try again.',
        ),
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (isAuthLoaded && isSignedIn) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="bg-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 font-sans sm:px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,theme(colors.brand.500/.14),transparent_38%),radial-gradient(circle_at_bottom,theme(colors.panel.subtle),transparent_34%)]"
      />

      <div
        aria-hidden="true"
        className="ambient-glow-surface-reduced pointer-events-none absolute top-[12%] left-1/2 h-[240px] w-[min(92vw,560px)] -translate-x-1/2 rounded-full opacity-70"
      />

      <div className="border-line-soft bg-panel/90 relative z-10 mx-auto w-full max-w-[28rem] overflow-hidden rounded-2xl border shadow-xl backdrop-blur-xl">
        <div className="border-line-soft bg-panel-subtle flex flex-col gap-3 border-b px-5 py-5 sm:px-6 sm:py-6">
          <div className="border-line bg-panel-muted flex h-11 w-11 items-center justify-center rounded-2xl border">
            <ShieldCheck className="brand-icon h-5 w-5" />
          </div>

          <div className="space-y-1.5">
            <h2 className="page-title-gradient text-xl font-bold tracking-tight sm:text-2xl">
              {step === 'credentials'
                ? 'User Sign-In'
                : 'Second Factor Verification'}
            </h2>
            <p className="text-muted-copy text-sm leading-6">
              {step === 'credentials'
                ? 'Authenticate with your account credentials.'
                : 'Enter the verification code sent to your email.'}
            </p>
          </div>
        </div>

        <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
          {error && (
            <div className="status-banner-danger rounded-xl border px-3 py-2.5 text-sm leading-5 backdrop-blur-md">
              {error}
            </div>
          )}

          {step === 'credentials' ? (
            <form className="space-y-5" onSubmit={submitCredentials}>
              <div className="space-y-2">
                <label
                  htmlFor="identifier"
                  className="text-muted-copy text-[11px] font-semibold tracking-[0.24em] uppercase"
                >
                  Email
                </label>
                <Input
                  id="identifier"
                  type="email"
                  autoComplete="username"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  className="brand-focus border-line bg-field text-ink h-11 rounded-xl px-3 text-sm shadow-xs focus-visible:ring-0 focus-visible:ring-offset-0"
                  required
                  disabled={disabled}
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="text-muted-copy text-[11px] font-semibold tracking-[0.24em] uppercase"
                >
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="brand-focus border-line bg-field text-ink h-11 rounded-xl px-3 text-sm shadow-xs focus-visible:ring-0 focus-visible:ring-offset-0"
                  required
                  disabled={disabled}
                />
              </div>

              <DenseButton
                type="submit"
                className="brand-button h-11 w-full justify-center rounded-xl text-sm font-medium shadow-lg"
                disabled={disabled}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Sign in
              </DenseButton>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={submitSecondFactor}>
              <div className="space-y-2">
                <label
                  htmlFor="code"
                  className="text-muted-copy text-[11px] font-semibold tracking-[0.24em] uppercase"
                >
                  Verification code
                </label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="brand-focus border-line bg-field text-ink h-11 rounded-xl px-3 text-sm shadow-xs focus-visible:ring-0 focus-visible:ring-offset-0"
                  required
                  disabled={disabled}
                />
              </div>

              <div className="flex gap-3">
                <DenseButton
                  type="submit"
                  className="brand-button h-11 flex-1 justify-center rounded-xl text-sm font-medium shadow-lg"
                  disabled={disabled}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Verify
                </DenseButton>
                <DenseButton
                  type="button"
                  className="border-line bg-field text-copy hover:bg-panel-hover h-11 rounded-xl px-4 text-sm"
                  disabled={disabled}
                  onClick={() => {
                    setStep('credentials')
                    setCode('')
                    setError(null)
                  }}
                >
                  Back
                </DenseButton>
              </div>
            </form>
          )}

          <div className="border-line-soft text-muted-copy border-t pt-5 text-sm">
            Need an account?{' '}
            <Link className="brand-link font-medium" to="/sign-up">
              Create one
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
