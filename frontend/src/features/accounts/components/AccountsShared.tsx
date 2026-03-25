import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import type { ProcessingSummary } from '../hooks/useAccountsState'
import { sumRecordValues } from '../hooks/useAccountsState'

export function StatusBanner({
  tone,
  children,
}: {
  tone: 'danger' | 'warning' | 'success'
  children: React.ReactNode
}) {
  const className =
    tone === 'danger'
      ? 'status-banner-danger'
      : tone === 'warning'
        ? 'border-status-warning-border bg-status-warning-soft text-status-warning'
        : 'border-status-success-border bg-status-success-soft text-status-success'

  const dotClassName =
    tone === 'danger'
      ? 'status-dot-danger'
      : tone === 'warning'
        ? 'bg-status-warning'
        : 'status-dot-success-tight'

  return (
    <div
      className={cn(
        'flex items-center gap-2 border px-4 py-3 text-sm',
        tone === 'danger' && 'border-y border-x-0',
        tone !== 'danger' && 'rounded-xl',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClassName)} />
      <span>{children}</span>
    </div>
  )
}

export function MetricCard({
  label,
  value,
  accent = 'default',
}: {
  label: string
  value: string
  accent?: 'default' | 'danger' | 'success'
}) {
  const accentClassName =
    accent === 'danger'
      ? 'text-status-danger'
      : accent === 'success'
        ? 'text-status-success'
        : 'text-ink'

  return (
    <div className="bg-panel-strong border-line rounded-2xl border p-4">
      <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
        {label}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold', accentClassName)}>
        {value}
      </div>
    </div>
  )
}

export function SamplePreview({
  fields,
  sampleRow,
  detectedUsernameField,
  detectedFullNameField,
  emptyMessage,
}: {
  fields: string[]
  sampleRow: Record<string, string>
  detectedUsernameField: string | null
  detectedFullNameField: string | null
  emptyMessage: string
}) {
  if (fields.length === 0) {
    return (
      <div className="text-subtle-copy rounded-xl border border-dashed px-4 py-6 text-sm">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border">
      <Table>
        <TableHeader>
          <TableRow className="border-line-soft bg-transparent hover:bg-transparent">
            {fields.map((field) => {
              const isDetected =
                field === detectedUsernameField ||
                field === detectedFullNameField

              return (
                <TableHead
                  key={field}
                  className={cn(
                    'text-muted-copy h-11 font-medium',
                    isDetected && 'text-ink',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span>{field}</span>
                    {field === detectedUsernameField ? (
                      <Badge className="brand-surface brand-text-soft border px-2 py-0 text-[10px]">
                        Username
                      </Badge>
                    ) : null}
                    {field === detectedFullNameField ? (
                      <Badge
                        variant="outline"
                        className="border-line bg-panel-muted text-copy px-2 py-0 text-[10px]"
                      >
                        Full name
                      </Badge>
                    ) : null}
                  </div>
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="border-line-soft hover:bg-transparent">
            {fields.map((field) => (
              <TableCell
                key={field}
                className="text-copy max-w-[180px] truncate font-mono text-xs"
                title={sampleRow[field] || '-'}
              >
                {sampleRow[field] || (
                  <span className="text-subtle-copy">-</span>
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

export function ProcessingResultPanel({
  title,
  summary,
  actionLabel,
  onReset,
}: {
  title: string
  summary: ProcessingSummary
  actionLabel: string
  onReset: () => void
}) {
  return (
    <div className="bg-panel-subtle border-line-soft rounded-3xl border p-5 shadow-xs backdrop-blur-xs">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-status-success flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>
          <p className="text-subtle-copy mt-1 text-sm">
            Review the result and continue with the next import.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw className="mr-2 h-4 w-4" />
          {actionLabel}
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-5">
        <MetricCard
          label="Processed"
          value={summary.stats.totalProcessed.toLocaleString()}
        />
        <MetricCard
          label="Filtered"
          value={summary.stats.removed.toLocaleString()}
          accent="danger"
        />
        <MetricCard
          label="Kept"
          value={summary.stats.remaining.toLocaleString()}
          accent="success"
        />
        <MetricCard
          label="Inserted"
          value={sumRecordValues(summary.uploaded).toLocaleString()}
        />
        <MetricCard
          label="Duplicates"
          value={sumRecordValues(summary.duplicates).toLocaleString()}
        />
      </div>
    </div>
  )
}
