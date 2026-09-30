import { Button } from '@/components/ui/button'
import { ArrowLeft, ArrowRight } from 'lucide-react'

export function PageControls({
  pageNumber,
  hasPrevious,
  hasNext,
  loading,
  previous,
  next,
}: {
  pageNumber: number
  hasPrevious: boolean
  hasNext: boolean
  loading: boolean
  previous: () => void
  next: () => void
}) {
  return (
    <nav
      aria-label="List pages"
      className="flex items-center justify-end gap-2 py-3 text-subtle-copy"
    >
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
      <span className="sr-only" aria-live="polite">
        Page {pageNumber}
      </span>
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
    </nav>
  )
}
