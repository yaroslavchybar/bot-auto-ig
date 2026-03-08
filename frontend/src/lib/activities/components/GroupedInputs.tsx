import { Label } from '@/components/ui/label'
import type { ActivityInput } from '../types'
import { InputField } from './InputField'

interface GroupedInputsProps {
  inputs: ActivityInput[]
  config: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
}

export function GroupedInputs({
  inputs,
  config,
  onChange,
}: GroupedInputsProps) {
  // Separate grouped and ungrouped inputs
  const groups: Record<string, ActivityInput[]> = {}
  const ungrouped: ActivityInput[] = []

  for (const input of inputs) {
    if (input.group) {
      if (!groups[input.group]) groups[input.group] = []
      groups[input.group].push(input)
    } else {
      ungrouped.push(input)
    }
  }

  return (
    <>
      {/* Ungrouped inputs first */}
      {ungrouped.map((input) => (
        <InputField
          key={input.name}
          input={input}
          value={config[input.name]}
          onChange={(value) => onChange(input.name, value)}
          config={config}
        />
      ))}

      {/* Grouped inputs */}
      {Object.entries(groups).map(([groupName, groupInputs]) => (
        <div
          key={groupName}
          className="mt-2 rounded-[3px] border border-neutral-300 bg-neutral-50/70 p-2 dark:border-neutral-700 dark:bg-neutral-900/40"
        >
          <Label className="mb-2 block font-mono text-[9px] font-bold tracking-widest text-neutral-500 uppercase dark:text-neutral-400">
            {groupName}
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {groupInputs.map((input) => (
              <InputField
                key={input.name}
                input={input}
                value={config[input.name]}
                onChange={(value) => onChange(input.name, value)}
                compact
                config={config}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
