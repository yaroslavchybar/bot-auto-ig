import { Input as BaseInput } from '@/components/ui/input'
import type { ActivityInput } from '@/features/workflows/activities/types'
import { cn } from '@/lib/utils'

interface MinMaxFieldProps {
  /** Section title, e.g. "Duration" */
  title?: string
  unit?: string
  minInput: ActivityInput
  maxInput: ActivityInput
  minValue: unknown
  maxValue: unknown
  onChange: (name: string, value: unknown) => void
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Renders a min/max number pair as one row: [Min] – [Max],
 * with a human summary ("15–30 min · avg ~22") and validation.
 */
export function MinMaxField({
  title,
  unit,
  minInput,
  maxInput,
  minValue,
  maxValue,
  onChange,
}: MinMaxFieldProps) {
  const resolvedUnit = unit ?? minInput.unit ?? maxInput.unit ?? ''
  const min = toNumber(
    minValue ?? minInput.default ?? minInput.min ?? 0,
    minInput.min ?? 0,
  )
  const max = toNumber(
    maxValue ?? maxInput.default ?? maxInput.min ?? 0,
    maxInput.min ?? 0,
  )
  const invalid = min > max
  const avg = (min + max) / 2
  const avgLabel =
    Math.abs(avg * 10 - Math.round(avg * 10)) < 1e-9
      ? String(Math.round(avg * 10) / 10)
      : avg.toFixed(1)

  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <span className="text-subtle-copy font-mono text-[10px] tracking-[0.14em] uppercase">
            Min
          </span>
          <div className="relative">
            <BaseInput
              type="number"
              aria-label={minInput.label}
              min={minInput.min}
              max={minInput.max}
              step={minInput.step}
              value={(minValue ?? minInput.default ?? '') as number}
              onChange={(e) => {
                const next = e.target.value
                onChange(minInput.name, next === '' ? '' : Number(next))
              }}
              className={cn(
                'border-line-soft bg-field-alt h-8 rounded-lg pr-8 text-[13px] tabular-nums',
                invalid && 'border-status-danger-border',
              )}
            />
            {resolvedUnit && (
              <span className="text-subtle-copy pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-[11px]">
                {resolvedUnit}
              </span>
            )}
          </div>
        </div>

        <span className="text-dim-copy pb-2 font-mono text-xs">–</span>

        <div className="min-w-0 flex-1 space-y-1">
          <span className="text-subtle-copy font-mono text-[10px] tracking-[0.14em] uppercase">
            Max
          </span>
          <div className="relative">
            <BaseInput
              type="number"
              aria-label={maxInput.label}
              min={maxInput.min}
              max={maxInput.max}
              step={maxInput.step}
              value={(maxValue ?? maxInput.default ?? '') as number}
              onChange={(e) => {
                const next = e.target.value
                onChange(maxInput.name, next === '' ? '' : Number(next))
              }}
              className={cn(
                'border-line-soft bg-field-alt h-8 rounded-lg pr-8 text-[13px] tabular-nums',
                invalid && 'border-status-danger-border',
              )}
            />
            {resolvedUnit && (
              <span className="text-subtle-copy pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-[11px]">
                {resolvedUnit}
              </span>
            )}
          </div>
        </div>
      </div>

      {invalid ? (
        <p className="text-status-danger text-[11px]">
          Min can&apos;t be more than max.
        </p>
      ) : (
        <p className="text-subtle-copy font-mono text-[11px] tabular-nums">
          {min}–{max}
          {resolvedUnit ? ` ${resolvedUnit}` : ''}
          {title ? ` ${title.toLowerCase()}` : ''}
          <span className="text-dim-copy"> · avg ~{avgLabel}</span>
        </p>
      )}
    </div>
  )
}
