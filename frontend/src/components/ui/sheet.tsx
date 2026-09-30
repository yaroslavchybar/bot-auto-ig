import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

const Sheet = SheetPrimitive.Root

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SheetPrimitive.Overlay>) => (
  <SheetPrimitive.Overlay
    className={cn('bg-overlay-strong fixed inset-0 z-50', className)}
    {...props}
    ref={ref}
  />
)
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva('bg-panel border-line fixed z-50 gap-4 p-6 text-copy shadow-xl', {
  variants: {
    side: {
      top: 'inset-x-0 top-0 border-b',
      bottom: 'inset-x-0 bottom-0 border-t',
      left: 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
      right: 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
    },
  },
  defaultVariants: {
    side: 'right',
  },
})

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = ({
  ref,
  side = 'right',
  className,
  children,
  ...props
}: SheetContentProps & { ref?: React.Ref<React.ElementRef<typeof SheetPrimitive.Content>> }) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
      <SheetPrimitive.Close className="absolute top-4 right-4 rounded-lg border border-transparent text-muted-copy opacity-80 hover:bg-panel-hover hover:text-ink hover:opacity-100 focus:ring-2 focus:ring-ring/60 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-panel-hover">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
)
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
)
SheetHeader.displayName = 'SheetHeader'

const SheetTitle = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SheetPrimitive.Title>) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('text-ink text-lg font-semibold', className)}
    {...props}
  />
)
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SheetPrimitive.Description>) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('text-muted-copy text-sm', className)}
    {...props}
  />
)
SheetDescription.displayName = SheetPrimitive.Description.displayName

export { Sheet, SheetPortal, SheetOverlay, SheetContent, SheetHeader, SheetTitle, SheetDescription }
