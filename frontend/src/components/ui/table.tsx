import * as React from 'react'

import { cn } from '@/lib/utils'

// `containerClassName` styles the scroll wrapper, e.g. a flex-1 height inside a fixed-height card.
const Table = ({
  ref,
  className,
  containerClassName,
  ...props
}: React.HTMLAttributes<HTMLTableElement> & {
  ref?: React.Ref<HTMLTableElement>
  containerClassName?: string
}) => (
  <div className={cn('relative w-full overflow-auto', containerClassName)}>
    <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
  </div>
)
Table.displayName = 'Table'

// Sticky headers need an opaque background to cover rows scrolling underneath.
const TableHeader = ({
  ref,
  className,
  sticky = false,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & {
  ref?: React.Ref<HTMLTableSectionElement>
  sticky?: boolean
}) => (
  <thead
    ref={ref}
    className={cn(
      '[&_tr]:border-b',
      sticky && '[&_th]:bg-table-header [&_th]:sticky [&_th]:top-0 [&_th]:z-10',
      className,
    )}
    {...props}
  />
)
TableHeader.displayName = 'TableHeader'

const TableBody = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & {
  ref?: React.Ref<HTMLTableSectionElement>
}) => <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
TableBody.displayName = 'TableBody'

const TableRow = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { ref?: React.Ref<HTMLTableRowElement> }) => (
  <tr
    ref={ref}
    className={cn('border-line-soft hover:bg-panel-subtle border-b', className)}
    {...props}
  />
)
TableRow.displayName = 'TableRow'

const TableHead = ({
  ref,
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { ref?: React.Ref<HTMLTableCellElement> }) => (
  <th
    ref={ref}
    className={cn(
      'text-muted-copy h-10 px-2 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      className,
    )}
    {...props}
  />
)
TableHead.displayName = 'TableHead'

const TableCell = ({
  ref,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { ref?: React.Ref<HTMLTableCellElement> }) => (
  <td
    ref={ref}
    className={cn(
      'p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      className,
    )}
    {...props}
  />
)
TableCell.displayName = 'TableCell'

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell }
