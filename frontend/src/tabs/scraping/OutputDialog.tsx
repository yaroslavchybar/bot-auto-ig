import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

function outputToText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output === null || output === undefined) return ''
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  output: unknown
}

export function OutputDialog({ open, onOpenChange, title, output }: Props) {
  const outputText = outputToText(output)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Output: {title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          <Textarea value={outputText} readOnly className="h-full min-h-[420px] font-mono text-xs" placeholder="No output yet..." />
        </div>
      </DialogContent>
    </Dialog>
  )
}

