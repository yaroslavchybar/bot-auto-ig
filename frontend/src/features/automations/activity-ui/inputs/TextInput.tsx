import { Input as BaseInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/automations/activities/types'

interface TextInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function TextInput({ input, value, onChange }: TextInputProps) {
  const displayValue = value ?? input.default ?? ''

  return (
    <div className="flex flex-col space-y-1.5">
      <Label htmlFor={input.name} className="text-[13px] font-medium text-copy">
        {input.label}
        {input.required && <span className="ml-1 text-status-danger">*</span>}
      </Label>
      <BaseInput
        id={input.name}
        type="text"
        value={displayValue as string}
        onChange={(e) => onChange(e.target.value)}
        placeholder={input.placeholder}
        className="h-8 rounded-lg border-line-soft bg-field-alt px-3 text-[13px] focus-visible:ring-2 focus-visible:ring-offset-0"
      />
      {input.helpText && (
        <p className="text-[11px] leading-snug text-subtle-copy">{input.helpText}</p>
      )}
    </div>
  )
}
