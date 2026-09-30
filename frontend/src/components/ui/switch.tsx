import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

const Switch = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SwitchPrimitives.Root>) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer brand-switch border-line focus-visible:ring-ring/60 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border shadow-xs focus-visible:ring-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'bg-inverse pointer-events-none block h-4 w-4 rounded-full shadow-md ring-0 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitives.Root>
)
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
