import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/workflows/activities/types'

interface BooleanInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function BooleanInput({ input, value, onChange }: BooleanInputProps) {
  const checked = Boolean(value ?? input.default ?? false)

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label
          htmlFor={input.name}
          className="text-copy cursor-pointer text-[13px] font-medium"
        >
          {input.label}
          {input.required && <span className="text-status-danger ml-1">*</span>}
        </Label>
        {input.helpText && (
          <p className="text-subtle-copy mt-0.5 text-[11px] leading-snug">
            {input.helpText}
          </p>
        )}
      </div>
      <Switch
        id={input.name}
        checked={checked}
        onCheckedChange={(next) => onChange(!!next)}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}
