import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/workflows/activities/types'
import { cn } from '@/lib/utils'

interface RangeInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
  compact?: boolean
}

// Strip a redundant " (%)" suffix — the unit is already shown in the value.
function cleanLabel(label: string): string {
  return label.replace(/\s*\(\s*%\s*\)\s*$/, '')
}

// Quick presets for 0–100 chance sliders.
const CHANCE_PRESETS = [
  { label: 'Off', value: 0 },
  { label: 'Low', value: 10 },
  { label: 'Med', value: 30 },
  { label: 'High', value: 60 },
]

export function RangeInput({ input, value, onChange }: RangeInputProps) {
  const min = input.min ?? 0
  const max = input.max ?? 100
  const step = input.step ?? 1
  const rawValue = Number(value ?? input.default ?? min)
  const numericValue = Number.isFinite(rawValue) ? rawValue : min
  const clampedValue = Math.min(Math.max(numericValue, min), max)
  const progress = max === min ? 0 : ((clampedValue - min) / (max - min)) * 100
  const isOff = clampedValue <= min
  const showPresets = min === 0 && max === 100

  // Editable text state so typing doesn't fight the slider.
  const [text, setText] = useState(String(clampedValue))
  useEffect(() => {
    setText(String(clampedValue))
  }, [clampedValue])

  const commit = (next: number) => {
    if (!Number.isFinite(next)) {
      setText(String(clampedValue))
      return
    }
    const rounded = min + Math.round((next - min) / step) * step
    const clamped = Math.min(Math.max(rounded, min), max)
    // Avoid float artifacts from fractional steps.
    const fixed = Number(clamped.toFixed(4))
    onChange(fixed)
    setText(String(fixed))
  }

  const nudge = (delta: number) => commit(clampedValue + delta)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={input.name}
          className="text-copy min-w-0 truncate text-[13px] font-medium"
        >
          {cleanLabel(input.label)}
        </Label>

        {/* Editable value stepper */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={`Decrease ${input.label}`}
            onClick={() => nudge(-step)}
            disabled={clampedValue <= min}
            className="text-subtle-copy hover:text-ink hover:bg-panel-hover flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-30"
          >
            <Minus className="h-3 w-3" />
          </button>
          <div
            className={cn(
              'flex h-6 items-center rounded-md border px-1.5 font-mono text-xs tabular-nums',
              isOff
                ? 'border-line-soft bg-field-alt text-subtle-copy'
                : 'border-status-info-border bg-status-info-soft text-ink',
            )}
          >
            <input
              id={input.name}
              type="number"
              aria-label={input.label}
              min={min}
              max={max}
              step={step}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={(e) => commit(Number(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit(Number((e.target as HTMLInputElement).value))
                }
              }}
              className="w-10 bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            {input.unit && (
              <span className="text-subtle-copy text-[11px]">{input.unit}</span>
            )}
          </div>
          <button
            type="button"
            aria-label={`Increase ${input.label}`}
            onClick={() => nudge(step)}
            disabled={clampedValue >= max}
            className="text-subtle-copy hover:text-ink hover:bg-panel-hover flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-30"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Slim slider — track fill drawn via background gradient */}
      <input
        type="range"
        aria-hidden={false}
        aria-label={`${input.label} slider`}
        tabIndex={-1}
        min={min}
        max={max}
        step={step}
        value={clampedValue}
        onChange={(event) => commit(Number(event.target.value))}
        style={{
          background: isOff
            ? 'var(--panel-soft)'
            : `linear-gradient(to right, var(--status-info) 0%, var(--status-info) ${progress}%, var(--panel-soft) ${progress}%, var(--panel-soft) 100%)`,
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-status-info-border focus-visible:ring-offset-0 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-panel [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-transform [&::-moz-range-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-panel [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
      />

      {showPresets && (
        <div className="flex gap-1.5">
          {CHANCE_PRESETS.map((preset) => {
            const active = clampedValue === preset.value
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => onChange(preset.value)}
                className={cn(
                  'h-6 rounded-full border px-2.5 font-mono text-[10px] transition-colors',
                  active
                    ? 'border-status-info-border bg-status-info-soft text-ink'
                    : 'border-line-soft text-subtle-copy hover:text-ink hover:bg-panel-hover',
                )}
              >
                {preset.label}
              </button>
            )
          })}
          <span className="text-dim-copy ml-auto hidden font-mono text-[10px] tabular-nums min-[400px]:block">
            {clampedValue}/{max}
          </span>
        </div>
      )}

      {input.helpText && (
        <p className="text-subtle-copy text-[11px] leading-snug">
          {input.helpText}
        </p>
      )}
    </div>
  )
}
