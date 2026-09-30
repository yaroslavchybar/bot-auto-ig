import type { ReactNode } from 'react'
import { Link } from '@/lib/router'
import { ShieldCheck } from 'lucide-react'

interface AuthCardShellProps {
  title: string
  description: string
  error?: string | null
  footerPrompt?: string
  footerLinkLabel?: string
  footerLinkTo?: string
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-shell px-4 py-8 font-sans sm:px-6">
      <div className="relative z-10 mx-auto w-full max-w-[28rem] overflow-hidden rounded-2xl border border-line-soft bg-panel/90 shadow-xl">
        <div className="flex flex-col gap-3 border-b border-line-soft bg-panel-subtle px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-panel-muted">
            <ShieldCheck className="h-5 w-5 brand-icon" />
          </div>

          <div className="space-y-1.5">
            <h2 className="page-title-gradient text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </h2>
            <p className="text-sm leading-6 text-muted-copy">{description}</p>
          </div>
        </div>

        <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
          {error ? (
            <div className="rounded-xl border status-banner-danger px-3 py-2.5 text-sm leading-5">
              {error}
            </div>
          ) : null}

          {children}

          {footerPrompt && footerLinkLabel && footerLinkTo ? (
            <div className="border-t border-line-soft pt-5 text-sm text-muted-copy">
              {footerPrompt}{' '}
              <Link className="font-medium brand-link" to={footerLinkTo}>
                {footerLinkLabel}
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
