import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
      <DialogContent className="bg-panel border-line text-ink flex h-[80vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="page-title-gradient text-xl font-bold">
            Output: {title}
          </DialogTitle>
        </DialogHeader>
        <div className="bg-field border-line flex-1 overflow-auto border-y py-1">
          <Textarea
            value={outputText}
            readOnly
            className="text-copy h-full min-h-[420px] resize-none border-0 bg-transparent p-4 font-mono text-xs focus-visible:ring-0"
            placeholder="No output yet..."
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}


