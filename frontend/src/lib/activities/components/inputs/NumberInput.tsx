import { Input as BaseInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '../../types'

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
    <div className="flex flex-col space-y-1">
      <Label
        htmlFor={input.name}
        className="flex justify-between text-[11px] font-medium text-neutral-700 dark:text-neutral-300"
      >
        <span>
          {input.label}
          {input.required && <span className="text-status-danger ml-1">*</span>}
        </span>
        {input.unit && !compact && (
          <span className="font-mono text-[10px] text-neutral-500">
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
          className="h-6 rounded-[2px] border-neutral-300 bg-white text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {compact && input.unit && (
          <span className="w-6 shrink-0 font-mono text-[10px] text-neutral-500">
            {input.unit}
          </span>
        )}
      </div>
      {input.helpText && (
        <p className="text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
          {input.helpText}
        </p>
      )}
    </div>
  )
}
