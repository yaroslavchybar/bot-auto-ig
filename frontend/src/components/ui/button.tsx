import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-xs leading-4 font-normal transition-[background-color,border-color,color,transform,outline-color] duration-200 ease-out focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'button-positive',
        warning: 'button-warning',
        destructive: 'button-danger',
        outline: 'button-neutral',
        secondary: 'button-neutral',
        ghost: 'button-ghost',
        link: 'text-copy underline-offset-4 hover:text-ink hover:underline',
      },
      size: {
        default: 'h-[26px] px-2.5 py-1',
        sm: 'h-6 px-2 text-[11px]',
        lg: 'h-8 px-4 text-sm',
        icon: 'h-[26px] w-[26px] p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }


