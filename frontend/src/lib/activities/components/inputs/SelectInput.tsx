import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import type { ActivityInput, ActivityInputOption } from '../../types'

interface SelectInputProps {
    input: ActivityInput
    value: unknown
    onChange: (value: unknown) => void
}

export function SelectInput({ input, value, onChange }: SelectInputProps) {
    const displayValue = value ?? input.default ?? ''

    return (
        <div className="space-y-1 flex flex-col">
            <Label htmlFor={input.name} className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                {input.label}
                {input.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Select
                value={String(displayValue)}
                onValueChange={(v) => onChange(v)}
            >
                <SelectTrigger className="h-7 rounded-[2px] text-[11px] focus:ring-1 focus:ring-offset-0 border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
                    <SelectValue placeholder={input.placeholder || 'Select...'} />
                </SelectTrigger>
                <SelectContent className="rounded-[2px] text-[11px]">
                    {input.options?.map((opt: ActivityInputOption) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {input.helpText && (
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight">{input.helpText}</p>
            )}
        </div>
    )
}
