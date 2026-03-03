import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '../../types'

interface RangeInputProps {
    input: ActivityInput
    value: unknown
    onChange: (value: unknown) => void
    compact?: boolean
}

export function RangeInput({ input, value, onChange, compact }: RangeInputProps) {
    const displayValue = value ?? input.default ?? ''

    return (
        <div className={compact ? "space-y-1" : "space-y-1"}>
            <Label htmlFor={input.name} className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                {input.label}
            </Label>
            <div className="flex items-center gap-2">
                <Input
                    id={input.name}
                    type="range"
                    min={input.min ?? 0}
                    max={input.max ?? 100}
                    step={input.step ?? 1}
                    value={displayValue as number}
                    onChange={(e) => onChange(Number(e.target.value))}
                    className="flex-1 h-3.5 accent-neutral-700 dark:accent-neutral-300 bg-neutral-200 dark:bg-neutral-800 rounded-full appearance-none cursor-pointer"
                />
                <span className="w-10 text-right text-[11px] text-neutral-500 font-mono">
                    {String(displayValue)}{input.unit || ''}
                </span>
            </div>
            {input.helpText && (
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight">{input.helpText}</p>
            )}
        </div>
    )
}
