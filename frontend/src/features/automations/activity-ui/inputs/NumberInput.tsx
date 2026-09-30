import { Input as BaseInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/automations/activities/types'

interface NumberInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
  compact?: boolean
}

export function NumberInput({ input, value, onChange, compact }: NumberInputProps) {
  const displayValue = value ?? input.default ?? ''

  return (
    <div className="flex min-w-0 flex-1 flex-col space-y-1.5">
      <Label htmlFor={input.name} className="truncate text-[13px] font-medium text-copy">
        {compact ? input.label.replace(/^(Min|Max)\s*/i, '') || input.label : input.label}
        {input.required && <span className="ml-1 text-status-danger">*</span>}
      </Label>
      <div className="relative">
        <BaseInput
          id={input.name}
          type="number"
          min={input.min}
          max={input.max}
          step={input.step}
          value={Number.isNaN(displayValue) ? '' : (displayValue as number)}
          onChange={(e) => {
            const next = e.target.value
            onChange(next === '' ? Number.NaN : Number(next))
          }}
          placeholder={input.placeholder}
          className="h-8 rounded-lg border-line-soft bg-field-alt pr-9 text-[13px] tabular-nums focus-visible:ring-2 focus-visible:ring-offset-0"
        />
        {input.unit && (
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[11px] text-subtle-copy">
            {input.unit}
          </span>
        )}
      </div>
      {input.helpText && !compact && (
        <p className="text-[11px] leading-snug text-subtle-copy">{input.helpText}</p>
      )}
    </div>
  )
}
