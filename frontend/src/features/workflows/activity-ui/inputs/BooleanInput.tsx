import { Checkbox } from '@/components/ui/checkbox'
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
    <div className="border-line-soft bg-panel-subtle/80 space-y-2 rounded-xl border p-3">
      <div className="flex items-center space-x-2">
        <Checkbox
          id={input.name}
          checked={!!displayValue}
          onCheckedChange={(checked) => onChange(!!checked)}
          className="h-3.5 w-3.5"
        />
        <Label
          htmlFor={input.name}
          className="text-copy cursor-pointer text-[11px] font-medium"
        >
          {input.label}
          {input.required && <span className="text-status-danger ml-1">*</span>}
        </Label>
      </div>
      {input.helpText && (
        <p className="text-subtle-copy pl-5 text-[10px] leading-tight">
          {input.helpText}
        </p>
      )}
    </div>
  )
}



