import * as React from 'react'

import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'border-line bg-field text-ink placeholder:text-subtle-copy focus-visible:border-line-strong focus-visible:ring-ring/60 flex min-h-[60px] w-full rounded-xl border px-3 py-2 text-base shadow-xs transition-[background-color,border-color,color,box-shadow] focus-visible:ring-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = 'Textarea'

export { Textarea }


