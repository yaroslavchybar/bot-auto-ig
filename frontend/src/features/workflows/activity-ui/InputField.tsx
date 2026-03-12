import type { ActivityInput } from '@/features/workflows/activities/types'
import { RangeInput } from './inputs/RangeInput'
import { BooleanInput } from './inputs/BooleanInput'
import { SelectInput } from './inputs/SelectInput'
import { NumberInput } from './inputs/NumberInput'
import { CodeInput } from './inputs/CodeInput'
import { TextInput } from './inputs/TextInput'
import { TemplateInput } from './TemplateInput'
import { ListSelectInput } from './inputs/ListSelectInput'

interface InputFieldProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
  compact?: boolean
  config?: Record<string, unknown>
}

export function InputField({
  input,
  value,
  onChange,
  compact,
  config,
}: InputFieldProps) {
  switch (input.type) {
    case 'range':
      return (
        <RangeInput
          input={input}
          value={value}
          onChange={onChange}
          compact={compact}
        />
      )
    case 'boolean':
      return <BooleanInput input={input} value={value} onChange={onChange} />
    case 'select':
      return <SelectInput input={input} value={value} onChange={onChange} />
    case 'number':
      return (
        <NumberInput
          input={input}
          value={value}
          onChange={onChange}
          compact={compact}
        />
      )
    case 'template':
      return <TemplateInput input={input} config={config} />
    case 'code':
      return <CodeInput input={input} value={value} onChange={onChange} />
    case 'list_select':
      return <ListSelectInput input={input} value={value} onChange={onChange} />
    case 'profile':
    case 'string':
    default:
      return <TextInput input={input} value={value} onChange={onChange} />
  }
}



