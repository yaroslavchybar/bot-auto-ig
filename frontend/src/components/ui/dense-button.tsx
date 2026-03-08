import * as React from 'react'
import { cn } from '@/lib/utils'

type DenseButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean
}

export function DenseButton({ active, className, children, type = 'button', ...props }: DenseButtonProps) {
    return (
        <button
            type={type}
            className={cn(
                'inline-flex h-6 items-center justify-center gap-2 rounded-[3px] border px-2 py-0 text-[11px] font-sans shadow-none transition-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
                active
                    ? 'border-neutral-400 bg-neutral-200 font-medium text-neutral-900 dark:border-neutral-500 dark:bg-neutral-700 dark:text-white'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
                className,
            )}
            {...props}
        >
            {children}
        </button>
    )
}
