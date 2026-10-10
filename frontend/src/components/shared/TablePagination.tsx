import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PAGE_SIZES, type PageSize } from '../../../../server/shared/pagination'

export type TablePaginationProps = {
  pageNumber: number
  hasPrevious: boolean
  hasNext: boolean
  loading: boolean
  previous: () => void
  next: () => void
  // Pass both to show the rows-per-page picker. Omit both for compact pickers in dialogs.
  pageSize?: PageSize
  onPageSizeChange?: (size: PageSize) => void
}

/** Footer for paged lists. Arrows and page number always show, so paging never scrolls away. */
export function TablePagination({
  pageNumber,
  hasPrevious,
  hasNext,
  loading,
  previous,
  next,
  pageSize,
  onPageSizeChange,
}: TablePaginationProps) {
  return (
    <nav
      aria-label="Table pages"
      className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5 text-xs text-subtle-copy"
    >
      {pageSize !== undefined && onPageSizeChange && (
        <RowsPerPage value={pageSize} onChange={onPageSizeChange} disabled={loading} />
      )}
      <div className="ml-auto flex items-center gap-2">
        <span aria-live="polite" className="px-1 tabular-nums">
          Page {pageNumber}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Previous page"
          title="Previous page"
          disabled={loading || !hasPrevious}
          onClick={previous}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Next page"
          title="Next page"
          disabled={loading || !hasNext}
          onClick={next}
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

/** Card for a paged table. The table fills the space above the footer and scrolls inside the card. */
export function TableCard({
  children,
  pagination,
}: {
  children: ReactNode
  pagination: TablePaginationProps
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line-soft bg-panel-subtle shadow-xs">
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <TablePagination {...pagination} />
    </div>
  )
}

function RowsPerPage({
  value,
  onChange,
  disabled,
}: {
  value: PageSize
  onChange: (size: PageSize) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span>Rows per page</span>
      <Select
        value={String(value)}
        disabled={disabled}
        onValueChange={(text) => {
          const size = PAGE_SIZES.find((option) => String(option) === text)
          if (size) onChange(size)
        }}
      >
        <SelectTrigger aria-label="Rows per page" className="h-8 w-[76px] px-2.5 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="panel-dropdown">
          {PAGE_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)} className="cursor-pointer text-xs">
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
