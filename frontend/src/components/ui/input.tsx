import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'border-line bg-field text-ink file:text-foreground placeholder:text-subtle-copy focus-visible:border-line-strong focus-visible:ring-ring/60 flex h-9 w-full overflow-hidden rounded-lg border px-3 py-1 text-base shadow-xs transition-[background-color,border-color,color,box-shadow] [-moz-appearance:textfield] file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 md:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }


