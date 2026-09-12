import { Input as BaseInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/workflows/activities/types'

interface NumberInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
  compact?: boolean
}

export function NumberInput({
  input,
  value,
  onChange,
  compact,
}: NumberInputProps) {
  const displayValue = value ?? input.default ?? ''

  return (
    <div className="flex min-w-0 flex-1 flex-col space-y-1.5">
      <Label
        htmlFor={input.name}
        className="text-copy truncate text-[13px] font-medium"
      >
        {compact ? input.label.replace(/^(Min|Max)\s*/i, '') || input.label : input.label}
        {input.required && <span className="text-status-danger ml-1">*</span>}
      </Label>
      <div className="relative">
        <BaseInput
          id={input.name}
          type="number"
          min={input.min}
          max={input.max}
          step={input.step}
          value={displayValue as number}
          onChange={(e) => {
            const next = e.target.value
            onChange(next === '' ? '' : Number(next))
          }}
          placeholder={input.placeholder}
          className="border-line-soft bg-field-alt h-8 rounded-lg pr-9 text-[13px] tabular-nums transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-offset-0"
        />
        {input.unit && (
          <span className="text-subtle-copy pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[11px]">
            {input.unit}
          </span>
        )}
      </div>
      {input.helpText && !compact && (
        <p className="text-subtle-copy text-[11px] leading-snug">
          {input.helpText}
        </p>
      )}
    </div>
  )
}
