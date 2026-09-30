import * as React from 'react'

import { cn } from '@/lib/utils'

const Breadcrumb = ({
  ref,
  ...props
}: React.ComponentPropsWithoutRef<'nav'> & {
  separator?: React.ReactNode
} & { ref?: React.Ref<HTMLElement> }) => <nav ref={ref} aria-label="breadcrumb" {...props} />
Breadcrumb.displayName = 'Breadcrumb'

const BreadcrumbList = ({ ref, className, ...props }: React.ComponentPropsWithRef<'ol'>) => (
  <ol
    ref={ref}
    className={cn(
      'text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm break-words sm:gap-2.5',
      className,
    )}
    {...props}
  />
)
BreadcrumbList.displayName = 'BreadcrumbList'

const BreadcrumbItem = ({ ref, className, ...props }: React.ComponentPropsWithRef<'li'>) => (
  <li ref={ref} className={cn('inline-flex items-center gap-1.5', className)} {...props} />
)
BreadcrumbItem.displayName = 'BreadcrumbItem'

const BreadcrumbPage = ({ ref, className, ...props }: React.ComponentPropsWithRef<'span'>) => (
  <span
    ref={ref}
    role="link"
    aria-disabled="true"
    aria-current="page"
    className={cn('text-foreground font-normal', className)}
    {...props}
  />
)
BreadcrumbPage.displayName = 'BreadcrumbPage'

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage }
