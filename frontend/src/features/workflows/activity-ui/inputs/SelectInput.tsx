import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ActivityInput, ActivityInputOption } from '@/features/workflows/activities/types'

interface SelectInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function SelectInput({ input, value, onChange }: SelectInputProps) {
  const displayValue = value ?? input.default ?? ''

  return (
    <div className="flex flex-col space-y-1">
      <Label
        htmlFor={input.name}
        className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300"
      >
        {input.label}
        {input.required && <span className="text-status-danger ml-1">*</span>}
      </Label>
      <Select value={String(displayValue)} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="h-6 rounded-[2px] border-neutral-300 bg-white text-[11px] focus:ring-1 focus:ring-offset-0 dark:border-neutral-700 dark:bg-neutral-900">
          <SelectValue placeholder={input.placeholder || 'Select...'} />
        </SelectTrigger>
        <SelectContent className="rounded-[2px] border-neutral-300 text-[11px] dark:border-neutral-700">
          {input.options?.map((opt: ActivityInputOption) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="text-[11px]"
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {input.helpText && (
        <p className="text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
          {input.helpText}
        </p>
      )}
    </div>
  )
}



