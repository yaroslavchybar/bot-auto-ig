import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/workflows/activities/types'

interface RangeInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function RangeInput({ input, value, onChange }: RangeInputProps) {
  const min = input.min ?? 0
  const max = input.max ?? 100
  const step = input.step ?? 1
  const rawValue = Number(value ?? input.default ?? min)
  const displayValue = Number.isFinite(rawValue) ? rawValue : min
  const clampedValue = Math.min(Math.max(displayValue, min), max)
  const progress =
    max === min ? 0 : ((clampedValue - min) / (max - min)) * 100
  const valueLabel = `${clampedValue}${input.unit || ''}`

  return (
    <div className="border-line-soft bg-panel-subtle/80 space-y-3 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Label
            htmlFor={input.name}
            className="text-copy text-[11px] font-medium"
          >
            {input.label}
          </Label>
          {(input.min !== undefined || input.max !== undefined) && (
            <p className="text-subtle-copy font-mono text-[10px] tracking-[0.16em] uppercase">
              Range {min} to {max}
              {input.unit ? ` ${input.unit}` : ''}
            </p>
          )}
        </div>
        <div className="border-line-soft bg-field-alt text-ink min-w-[64px] rounded-lg border px-2.5 py-1 text-right font-mono text-xs shadow-xs">
          {valueLabel}
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <div className="bg-panel-soft h-3 rounded-full" />
          <div
            className="from-status-info to-status-info-strong pointer-events-none absolute inset-y-0 left-0 rounded-full bg-linear-to-r"
            style={{ width: `${progress}%` }}
          />
          <input
            id={input.name}
            type="range"
            min={min}
            max={max}
            step={step}
            value={clampedValue}
            onChange={(event) => onChange(Number(event.target.value))}
            className="absolute inset-0 h-3 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:bg-status-info [&::-moz-range-thumb]:border-line-soft [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:shadow-md [&::-moz-range-track]:h-3 [&::-moz-range-track]:rounded-full [&::-webkit-slider-runnable-track]:h-3 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:bg-status-info [&::-webkit-slider-thumb]:border-line-soft [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:shadow-md"
          />
        </div>

        <div className="text-subtle-copy flex items-center justify-between font-mono text-[10px] uppercase">
          <span>{min}</span>
          <span>
            Step {step}
            {input.unit ? ` ${input.unit}` : ''}
          </span>
          <span>{max}</span>
        </div>
      </div>

      {input.helpText && (
        <p className="text-subtle-copy text-[10px] leading-tight">
          {input.helpText}
        </p>
      )}
    </div>
  )
}



