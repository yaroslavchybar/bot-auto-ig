import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '@clerk/react-router'
import { useSignUp } from '@clerk/react-router/legacy'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import {
  AuthCardShell,
  AuthField,
} from '@/components/shared/AuthCardShell'
import { Button } from '@/components/ui/button'
import {
  getSafeRedirectTarget,
  REDIRECT_URL_PARAM,
} from '@/lib/auth-routing'
import { getClerkErrorMessage } from '@/lib/clerk-errors'

type SignUpStep = 'credentials' | 'emailVerification'

/* ── Sign-Up Form ── */

function SignUpForm({
  emailAddress,
  password,
  disabled,
  submitting,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  emailAddress: string
  password: string
  disabled: boolean
  submitting: boolean
  onEmailChange: (v: string) => void
  onPasswordChange: (v: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <AuthField
        id="identifier"
        label="Email"
        type="email"
        autoComplete="username"
        value={emailAddress}
        disabled={disabled}
        onChange={onEmailChange}
      />
      <AuthField
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        disabled={disabled}
        onChange={onPasswordChange}
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
  )
}

/* ── Verification Form ── */

function VerificationForm({
  code,
  disabled,
  submitting,
  onCodeChange,
  onSubmit,
  onBack,
}: {
  code: string
  disabled: boolean
  submitting: boolean
  onCodeChange: (v: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onBack: () => void
}) {
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <AuthField
        id="code"
        label="Verification code"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        disabled={disabled}
        onChange={onCodeChange}
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
          onClick={onBack}
        >
          Back
        </Button>
      </div>
    </form>
  )
}

/* ── Main Page Container ── */

/* ── Sign-up submission logic ── */

async function handleSignUpSubmit(
  signUp: ReturnType<typeof useSignUp>['signUp'],
  setActive: ReturnType<typeof useSignUp>['setActive'],
  navigate: ReturnType<typeof useNavigate>,
  redirectTarget: string,
  emailAddress: string,
  password: string,
  setStep: (s: SignUpStep) => void,
) {
  const result = await signUp!.create({ emailAddress: emailAddress.trim(), password })
  if (result.status === 'complete') {
    await setActive!({ session: result.createdSessionId })
    navigate(redirectTarget, { replace: true })
    return
  }
  await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' })
  setStep('emailVerification')
}

/* ── Sign-up state hook ── */

function useSignUpState() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth()
  const { isLoaded: isSignUpLoaded, signUp, setActive } = useSignUp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState<SignUpStep>('credentials')
  const [emailAddress, setEmailAddress] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const redirectTarget = getSafeRedirectTarget(
    searchParams.get(REDIRECT_URL_PARAM),
    typeof window === 'undefined' ? undefined : window.location.origin,
  )
  const disabled = submitting || !isAuthLoaded || !isSignUpLoaded

  const submitSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isSignUpLoaded) return
    setSubmitting(true); setError(null)
    try {
      await handleSignUpSubmit(signUp, setActive, navigate, redirectTarget, emailAddress, password, setStep)
    } catch (cause) {
      setError(getClerkErrorMessage(cause, 'Sign-up failed. Check your details and try again.'))
    } finally { setSubmitting(false) }
  }

  const submitVerificationCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isSignUpLoaded) return
    setSubmitting(true); setError(null)
    try {
      const result = await signUp!.attemptEmailAddressVerification({ code: code.trim() })
      if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId })
        navigate(redirectTarget, { replace: true }); return
      }
      setError(`Verification did not complete. Clerk status: ${result.status}.`)
    } catch (cause) {
      setError(getClerkErrorMessage(cause, 'Email verification failed. Check the code and try again.'))
    } finally { setSubmitting(false) }
  }

  const resetToCredentials = () => { setStep('credentials'); setCode(''); setError(null) }

  return {
    isAuthLoaded, isSignedIn, step, emailAddress, password, code, submitting,
    error, disabled, setEmailAddress, setPassword, setCode,
    submitSignUp, submitVerificationCode, resetToCredentials,
  }
}

/* ── Main Page Container ── */

export function SignUpPageContainer() {
  const s = useSignUpState()
  if (s.isAuthLoaded && s.isSignedIn) return <Navigate to="/" replace />

  return (
    <AuthCardShell
      title={s.step === 'credentials' ? 'User Sign-Up' : 'Email Verification'}
      description={s.step === 'credentials' ? 'Create your account credentials.' : 'Enter the verification code sent to your email.'}
      error={s.error}
      footerPrompt="Already have an account?" footerLinkLabel="Sign in" footerLinkTo="/sign-in"
    >
      {s.step === 'credentials' ? (
        <SignUpForm emailAddress={s.emailAddress} password={s.password}
          disabled={s.disabled} submitting={s.submitting}
          onEmailChange={s.setEmailAddress} onPasswordChange={s.setPassword} onSubmit={s.submitSignUp} />
      ) : (
        <VerificationForm code={s.code} disabled={s.disabled} submitting={s.submitting}
          onCodeChange={s.setCode} onSubmit={s.submitVerificationCode} onBack={s.resetToCredentials} />
      )}
    </AuthCardShell>
  )
}
