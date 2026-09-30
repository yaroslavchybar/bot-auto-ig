import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Overlay>) => (
  <AlertDialogPrimitive.Overlay
    className={cn('bg-overlay-strong fixed inset-0 z-50', className)}
    {...props}
    ref={ref}
  />
)
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Content>) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        'bg-panel border-line fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border p-6 text-copy shadow-xl sm:rounded-2xl',
        className,
      )}
      {...props}
    />
  </AlertDialogPortal>
)
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
)
AlertDialogHeader.displayName = 'AlertDialogHeader'

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
)
AlertDialogFooter.displayName = 'AlertDialogFooter'

const AlertDialogTitle = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('text-ink text-lg font-semibold', className)}
    {...props}
  />
)
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('text-muted-copy text-sm', className)}
    {...props}
  />
)
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const AlertDialogAction = ({
  ref,
  className,
  variant,
  size,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> &
  VariantProps<typeof buttonVariants> & {
    ref?: React.Ref<React.ElementRef<typeof AlertDialogPrimitive.Action>>
  }) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants({ variant, size }), className)}
    {...props}
  />
)
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = ({
  ref,
  className,
  variant,
  size,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel> &
  VariantProps<typeof buttonVariants> & {
    ref?: React.Ref<React.ElementRef<typeof AlertDialogPrimitive.Cancel>>
  }) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(
      buttonVariants({ variant: variant ?? 'outline', size }),
      'mt-2 sm:mt-0',
      className,
    )}
    {...props}
  />
)
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
