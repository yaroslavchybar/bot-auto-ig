import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '@clerk/react-router'
import { useSignIn } from '@clerk/react-router/legacy'
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

type SignInStep = 'credentials' | 'secondFactorEmailCode'

/* ── Credentials Form ── */

function CredentialsForm({
  identifier,
  password,
  disabled,
  submitting,
  onIdentifierChange,
  onPasswordChange,
  onSubmit,
}: {
  identifier: string
  password: string
  disabled: boolean
  submitting: boolean
  onIdentifierChange: (v: string) => void
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
        value={identifier}
        disabled={disabled}
        onChange={onIdentifierChange}
      />
      <AuthField
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        disabled={disabled}
        onChange={onPasswordChange}
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
  )
}

/* ── Second Factor Form ── */

function SecondFactorForm({
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

/* ── Credentials submission logic ── */

async function handleCredentialsSubmit(
  signIn: ReturnType<typeof useSignIn>['signIn'],
  setActive: ReturnType<typeof useSignIn>['setActive'],
  navigate: ReturnType<typeof useNavigate>,
  redirectTarget: string,
  identifier: string,
  password: string,
  setStep: (s: SignInStep) => void,
  setError: (e: string | null) => void,
) {
  const result = await signIn!.create({ identifier: identifier.trim(), password })
  if (result.status === 'complete') {
    await setActive!({ session: result.createdSessionId })
    navigate(redirectTarget, { replace: true })
    return
  }
  if (result.status === 'needs_second_factor') {
    const emailCodeFactor = result.supportedSecondFactors?.find(
      (f) => f.strategy === 'email_code' && 'emailAddressId' in f,
    )
    if (emailCodeFactor && typeof emailCodeFactor.emailAddressId === 'string') {
      await signIn!.prepareSecondFactor({ strategy: 'email_code', emailAddressId: emailCodeFactor.emailAddressId })
      setStep('secondFactorEmailCode')
      return
    }
    setError('A second factor is required, but email code verification is not available for this account.')
    return
  }
  setError(`Unable to complete sign-in. Clerk status: ${result.status}.`)
}

/* ── Second factor submission logic ── */

async function handleSecondFactorSubmit(
  signIn: ReturnType<typeof useSignIn>['signIn'],
  setActive: ReturnType<typeof useSignIn>['setActive'],
  navigate: ReturnType<typeof useNavigate>,
  redirectTarget: string,
  code: string,
  setError: (e: string | null) => void,
) {
  const result = await signIn!.attemptSecondFactor({ strategy: 'email_code', code: code.trim() })
  if (result.status === 'complete') {
    await setActive!({ session: result.createdSessionId })
    navigate(redirectTarget, { replace: true })
    return
  }
  setError(`Verification did not complete. Clerk status: ${result.status}.`)
}

/* ── Sign-in state hook ── */

function useSignInState() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth()
  const { isLoaded: isSignInLoaded, signIn, setActive } = useSignIn()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState<SignInStep>('credentials')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const redirectTarget = getSafeRedirectTarget(
    searchParams.get(REDIRECT_URL_PARAM),
    typeof window === 'undefined' ? undefined : window.location.origin,
  )
  const disabled = submitting || !isAuthLoaded || !isSignInLoaded

  const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isSignInLoaded) return
    setSubmitting(true); setError(null)
    try {
      await handleCredentialsSubmit(signIn, setActive, navigate, redirectTarget, identifier, password, setStep, setError)
    } catch (cause) {
      setError(getClerkErrorMessage(cause, 'Sign-in failed. Check your credentials and try again.'))
    } finally { setSubmitting(false) }
  }

  const submitSecondFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isSignInLoaded) return
    setSubmitting(true); setError(null)
    try {
      await handleSecondFactorSubmit(signIn, setActive, navigate, redirectTarget, code, setError)
    } catch (cause) {
      setError(getClerkErrorMessage(cause, 'Verification failed. Check the code and try again.'))
    } finally { setSubmitting(false) }
  }

  const resetToCredentials = () => { setStep('credentials'); setCode(''); setError(null) }

  return {
    isAuthLoaded, isSignedIn, step, identifier, password, code, submitting,
    error, disabled, setIdentifier, setPassword, setCode,
    submitCredentials, submitSecondFactor, resetToCredentials,
  }
}

/* ── Main Page Container ── */

export function SignInPageContainer() {
  const s = useSignInState()
  if (s.isAuthLoaded && s.isSignedIn) return <Navigate to="/" replace />

  return (
    <AuthCardShell
      title={s.step === 'credentials' ? 'User Sign-In' : 'Second Factor Verification'}
      description={s.step === 'credentials' ? 'Authenticate with your account credentials.' : 'Enter the verification code sent to your email.'}
      error={s.error}
      footerPrompt="Need an account?" footerLinkLabel="Create one" footerLinkTo="/sign-up"
    >
      {s.step === 'credentials' ? (
        <CredentialsForm identifier={s.identifier} password={s.password}
          disabled={s.disabled} submitting={s.submitting}
          onIdentifierChange={s.setIdentifier} onPasswordChange={s.setPassword} onSubmit={s.submitCredentials} />
      ) : (
        <SecondFactorForm code={s.code} disabled={s.disabled} submitting={s.submitting}
          onCodeChange={s.setCode} onSubmit={s.submitSecondFactor} onBack={s.resetToCredentials} />
      )}
    </AuthCardShell>
  )
}
