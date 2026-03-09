import type { ActivityInput } from '@/features/workflows/activities/types'
import { PythonCodeField } from '../PythonCodeField'

interface CodeInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function CodeInput({ input, value, onChange }: CodeInputProps) {
  return <PythonCodeField input={input} value={value} onChange={onChange} />
}



