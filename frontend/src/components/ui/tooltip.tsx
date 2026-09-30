import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = ({
  ref,
  className,
  sideOffset = 4,
  ...props
}: React.ComponentPropsWithRef<typeof TooltipPrimitive.Content>) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'bg-panel-strong text-copy border-line z-50 origin-(--radix-tooltip-content-transform-origin) overflow-hidden rounded-lg border px-3 py-1.5 text-xs shadow-xl',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
)
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
