import type { ActivityInput } from '../../types'
import { PythonCodeField } from '../../pythonnode/PythonCodeField'

interface CodeInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function CodeInput({ input, value, onChange }: CodeInputProps) {
  return <PythonCodeField input={input} value={value} onChange={onChange} />
}
