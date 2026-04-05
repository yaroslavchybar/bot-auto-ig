import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/workflows/activities/types'

interface BooleanInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function BooleanInput({ input, value, onChange }: BooleanInputProps) {
  const displayValue = value ?? input.default ?? ''

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label
          htmlFor={input.name}
          className="text-copy cursor-pointer text-[11px] font-medium"
        >
          {input.label}
          {input.required && <span className="text-status-danger ml-1">*</span>}
        </Label>
        <Switch
          id={input.name}
          checked={!!displayValue}
          onCheckedChange={(checked) => onChange(!!checked)}
        />
      </div>
      {input.helpText && (
        <p className="text-subtle-copy text-[10px] leading-tight">
          {input.helpText}
        </p>
      )}
    </div>
  )
}
