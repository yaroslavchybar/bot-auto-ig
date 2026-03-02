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
          (factor) => factor.strategy === 'email_code' && 'emailAddressId' in factor
        )

        if (emailCodeFactor && typeof emailCodeFactor.emailAddressId === 'string') {
          await signIn.prepareSecondFactor({
            strategy: 'email_code',
            emailAddressId: emailCodeFactor.emailAddressId,
          })
          setStep('secondFactorEmailCode')
          return
        }

        setError('A second factor is required, but email code verification is not available for this account.')
        return
      }

      setError(`Unable to complete sign-in. Clerk status: ${signInAttempt.status}.`)
    } catch (cause) {
      setError(getClerkErrorMessage(cause, 'Sign-in failed. Check your credentials and try again.'))
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

      setError(`Verification did not complete. Clerk status: ${signInAttempt.status}.`)
    } catch (cause) {
      setError(getClerkErrorMessage(cause, 'Verification failed. Check the code and try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isAuthLoaded && isSignedIn) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-neutral-200 dark:bg-neutral-900 p-3 sm:p-6 font-sans">
      <div className="mx-auto w-full max-w-md border border-neutral-300 dark:border-neutral-700 rounded-[3px] bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
        <div className="border-b border-neutral-300 dark:border-neutral-700 px-3 py-2 bg-neutral-200/70 dark:bg-neutral-900/40">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
              {step === 'credentials' ? 'User Sign-In' : 'Second Factor Verification'}
            </h2>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            {step === 'credentials'
              ? 'Authenticate with your account credentials.'
              : 'Enter the verification code sent to your email.'}
          </p>
        </div>

        <div className="p-3 sm:p-4">
          {error && (
            <div className="mb-3 rounded-[3px] border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {step === 'credentials' ? (
            <form className="space-y-3" onSubmit={submitCredentials}>
              <div className="space-y-1">
                <label htmlFor="identifier" className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500">Email</label>
                <Input
                  id="identifier"
                  type="email"
                  autoComplete="username"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  className="h-7 rounded-[3px] border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-[11px] px-2 py-0 focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
                  required
                  disabled={disabled}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="password" className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500">Password</label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-7 rounded-[3px] border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-[11px] px-2 py-0 focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
                  required
                  disabled={disabled}
                />
              </div>

              <DenseButton type="submit" className="w-full justify-center" disabled={disabled}>
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                Sign in
              </DenseButton>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={submitSecondFactor}>
              <div className="space-y-1">
                <label htmlFor="code" className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500">Verification code</label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="h-7 rounded-[3px] border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-[11px] px-2 py-0 focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
                  required
                  disabled={disabled}
                />
              </div>

              <div className="flex gap-2">
                <DenseButton type="submit" className="flex-1 justify-center" disabled={disabled}>
                  {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                  Verify
                </DenseButton>
                <DenseButton
                  type="button"
                  className="px-3"
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

          <div className="mt-3 border-t border-neutral-300 dark:border-neutral-700 pt-2 text-[11px] text-neutral-500">
            Need an account?{' '}
            <Link className="text-blue-700 dark:text-blue-400 hover:underline" to="/sign-up">
              Create one
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
