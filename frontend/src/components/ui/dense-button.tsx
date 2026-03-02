import { Button } from '@/components/ui/button'
import * as React from 'react'

export function DenseButton({ active, className, children, ...props }: React.ComponentProps<typeof Button> & { active?: boolean }) {
    return (
        <Button
            variant="outline"
            size="sm"
            className={`h-6 px-2 py-0 text-[11px] rounded-[3px] border-neutral-300 dark:border-neutral-600 font-sans shadow-none transition-none ${active ? 'bg-neutral-200 dark:bg-neutral-700 border-neutral-400 dark:border-neutral-500 font-medium text-neutral-900 dark:text-white' : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'} ${className}`}
            {...props}
        >
            {children}
        </Button>
    )
}
