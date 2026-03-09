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
    <div className="space-y-1.5 rounded-[3px] border border-neutral-300 bg-neutral-50/70 p-2 dark:border-neutral-700 dark:bg-neutral-900/40">
      <div className="flex items-center space-x-2">
        <Checkbox
          id={input.name}
          checked={!!displayValue}
          onCheckedChange={(checked) => onChange(!!checked)}
          className="h-3.5 w-3.5"
        />
        <Label
          htmlFor={input.name}
          className="cursor-pointer text-[11px] font-medium text-neutral-700 dark:text-neutral-300"
        >
          {input.label}
          {input.required && <span className="text-status-danger ml-1">*</span>}
        </Label>
      </div>
      {input.helpText && (
        <p className="pl-5 text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
          {input.helpText}
        </p>
      )}
    </div>
  )
}



