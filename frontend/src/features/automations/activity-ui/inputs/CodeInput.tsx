import type { ActivityInput } from '@/features/automations/activities/types'
import { TypeScriptCodeField } from '../TypeScriptCodeField'

interface CodeInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function CodeInput({ input, value, onChange }: CodeInputProps) {
  return <TypeScriptCodeField input={input} value={value} onChange={onChange} />
}



