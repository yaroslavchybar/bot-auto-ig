import { Input as BaseInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '../../types'

interface TextInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function TextInput({ input, value, onChange }: TextInputProps) {
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
      <BaseInput
        id={input.name}
        type="text"
        value={displayValue as string}
        onChange={(e) => onChange(e.target.value)}
        placeholder={input.placeholder}
        className="h-6 rounded-[2px] border-neutral-300 bg-white text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 dark:border-neutral-700 dark:bg-neutral-900"
      />
      {input.helpText && (
        <p className="text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
          {input.helpText}
        </p>
      )}
    </div>
  )
}
