import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth, useSignIn } from '@clerk/clerk-react'
import { Navigate, useNavigate } from 'react-router'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import {
  AuthCardShell,
  AuthField,
} from '@/components/shared/AuthCardShell'
import { Button } from '@/components/ui/button'
import { getClerkErrorMessage } from '@/lib/clerk-errors'

type SignInStep = 'credentials' | 'secondFactorEmailCode'

export function SignInPageContainer() {
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
    <AuthCardShell
      title={
        step === 'credentials' ? 'User Sign-In' : 'Second Factor Verification'
      }
      description={
        step === 'credentials'
          ? 'Authenticate with your account credentials.'
          : 'Enter the verification code sent to your email.'
      }
      error={error}
      footerPrompt="Need an account?"
      footerLinkLabel="Create one"
      footerLinkTo="/sign-up"
    >
      {step === 'credentials' ? (
        <form className="space-y-5" onSubmit={submitCredentials}>
          <AuthField
            id="identifier"
            label="Email"
            type="email"
            autoComplete="username"
            value={identifier}
            disabled={disabled}
            onChange={setIdentifier}
          />
          <AuthField
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={disabled}
            onChange={setPassword}
          />
          <Button
            type="submit"
            className="h-11 w-full justify-center rounded-xl text-sm font-medium shadow-lg"
            disabled={disabled}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            Sign in
          </Button>
        </form>
      ) : (
        <form className="space-y-5" onSubmit={submitSecondFactor}>
          <AuthField
            id="code"
            label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            disabled={disabled}
            onChange={setCode}
          />

          <div className="flex gap-3">
            <Button
              type="submit"
              className="h-11 flex-1 justify-center rounded-xl text-sm font-medium shadow-lg"
              disabled={disabled}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              Verify
            </Button>
            <Button
              variant="outline"
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
            </Button>
          </div>
        </form>
      )}
    </AuthCardShell>
  )
}



