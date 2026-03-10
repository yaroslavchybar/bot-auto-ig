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
    <div className="flex flex-col space-y-1.5">
      <Label
        htmlFor={input.name}
        className="text-copy flex justify-between text-[11px] font-medium"
      >
        <span>
          {input.label}
          {input.required && <span className="text-status-danger ml-1">*</span>}
        </span>
        {input.unit && !compact && (
          <span className="text-subtle-copy font-mono text-[10px]">
            {input.unit}
          </span>
        )}
      </Label>
      <div className="flex items-center gap-1.5">
        <BaseInput
          id={input.name}
          type="number"
          min={input.min}
          max={input.max}
          step={input.step}
          value={displayValue as number}
          onChange={(e) => onChange(Number(e.target.value))}
          placeholder={input.placeholder}
          className="border-line-soft bg-field-alt h-9 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-0"
        />
        {compact && input.unit && (
          <span className="text-subtle-copy w-8 shrink-0 font-mono text-[10px]">
            {input.unit}
          </span>
        )}
      </div>
      {input.helpText && (
        <p className="text-subtle-copy text-[10px] leading-tight">
          {input.helpText}
        </p>
      )}
    </div>
  )
}



