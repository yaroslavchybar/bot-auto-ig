import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface AuthCardShellProps {
  title: string
  description: string
  error?: string | null
  footerPrompt: string
  footerLinkLabel: string
  footerLinkTo: string
  children: ReactNode
}

export function AuthCardShell({
  title,
  description,
  error,
  footerPrompt,
  footerLinkLabel,
  footerLinkTo,
  children,
}: AuthCardShellProps) {
  return (
    <div className="bg-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 font-sans sm:px-6">
      <div className="border-line-soft bg-panel/90 relative z-10 mx-auto w-full max-w-[28rem] overflow-hidden rounded-2xl border shadow-xl backdrop-blur-xl">
        <div className="border-line-soft bg-panel-subtle flex flex-col gap-3 border-b px-5 py-5 sm:px-6 sm:py-6">
          <div className="border-line bg-panel-muted flex h-11 w-11 items-center justify-center rounded-2xl border">
            <ShieldCheck className="brand-icon h-5 w-5" />
          </div>

          <div className="space-y-1.5">
            <h2 className="page-title-gradient text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </h2>
            <p className="text-muted-copy text-sm leading-6">{description}</p>
          </div>
        </div>

        <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
          {error ? (
            <div className="status-banner-danger rounded-xl border px-3 py-2.5 text-sm leading-5 backdrop-blur-md">
              {error}
            </div>
          ) : null}

          {children}

          <div className="border-line-soft text-muted-copy border-t pt-5 text-sm">
            {footerPrompt}{' '}
            <Link className="brand-link font-medium" to={footerLinkTo}>
              {footerLinkLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

interface AuthFieldProps {
  id: string
  label: string
  type?: string
  autoComplete?: string
  inputMode?: React.ComponentProps<typeof Input>['inputMode']
  value: string
  disabled: boolean
  onChange: (value: string) => void
}

export function AuthField({
  id,
  label,
  type = 'text',
  autoComplete,
  inputMode,
  value,
  disabled,
  onChange,
}: AuthFieldProps) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="text-muted-copy text-[11px] font-semibold tracking-[0.24em] uppercase"
      >
        {label}
      </label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="brand-focus border-line bg-field text-ink h-11 rounded-xl px-3 text-sm shadow-xs focus-visible:ring-0 focus-visible:ring-offset-0"
        required
        disabled={disabled}
      />
    </div>
  )
}

