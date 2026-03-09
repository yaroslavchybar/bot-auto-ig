import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth, useSignUp } from '@clerk/clerk-react'
import { Navigate, useNavigate } from 'react-router'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import {
  AuthCardShell,
  AuthField,
} from '@/components/shared/AuthCardShell'
import { Button } from '@/components/ui/button'
import { getClerkErrorMessage } from '@/lib/clerk-errors'

type SignUpStep = 'credentials' | 'emailVerification'

export function SignUpPageContainer() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth()
  const { isLoaded: isSignUpLoaded, signUp, setActive } = useSignUp()
  const navigate = useNavigate()

  const [step, setStep] = useState<SignUpStep>('credentials')
  const [emailAddress, setEmailAddress] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = submitting || !isAuthLoaded || !isSignUpLoaded

  const submitSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isSignUpLoaded) return

    setSubmitting(true)
    setError(null)

    try {
      const signUpAttempt = await signUp.create({
        emailAddress: emailAddress.trim(),
        password,
      })

      if (signUpAttempt.status === 'complete') {
        await setActive({ session: signUpAttempt.createdSessionId })
        navigate('/', { replace: true })
        return
      }

      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      setStep('emailVerification')
    } catch (cause) {
      setError(
        getClerkErrorMessage(
          cause,
          'Sign-up failed. Check your details and try again.',
        ),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const submitVerificationCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isSignUpLoaded) return

    setSubmitting(true)
    setError(null)

    try {
      const verificationAttempt = await signUp.attemptEmailAddressVerification({
        code: code.trim(),
      })

      if (verificationAttempt.status === 'complete') {
        await setActive({ session: verificationAttempt.createdSessionId })
        navigate('/', { replace: true })
        return
      }

      setError(
        `Verification did not complete. Clerk status: ${verificationAttempt.status}.`,
      )
    } catch (cause) {
      setError(
        getClerkErrorMessage(
          cause,
          'Email verification failed. Check the code and try again.',
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
      title={step === 'credentials' ? 'User Sign-Up' : 'Email Verification'}
      description={
        step === 'credentials'
          ? 'Create your account credentials.'
          : 'Enter the verification code sent to your email.'
      }
      error={error}
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkTo="/sign-in"
    >
      {step === 'credentials' ? (
        <form className="space-y-5" onSubmit={submitSignUp}>
          <AuthField
            id="identifier"
            label="Email"
            type="email"
            autoComplete="username"
            value={emailAddress}
            disabled={disabled}
            onChange={setEmailAddress}
          />
          <AuthField
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={disabled}
            onChange={setPassword}
          />

          <div id="clerk-captcha" />

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
            Create account
          </Button>
        </form>
      ) : (
        <form className="space-y-5" onSubmit={submitVerificationCode}>
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



