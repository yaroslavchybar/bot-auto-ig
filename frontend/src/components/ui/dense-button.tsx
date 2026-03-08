import * as React from 'react'
import { cn } from '@/lib/utils'

type DenseButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
}

export function DenseButton({
  active,
  className,
  children,
  type = 'button',
  ...props
}: DenseButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-6 items-center justify-center gap-2 rounded-[3px] px-2 py-0 font-sans text-[11px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        active
          ? 'brand-button font-medium'
          : 'border-line bg-field text-copy hover:bg-panel-hover hover:text-ink border transition-colors',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
