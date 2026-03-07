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
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col bg-[#0a0a0a] border-white/10 text-gray-200">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Output: {title}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto bg-black/50 border-y border-white/10 py-1">
          <Textarea
            value={outputText}
            readOnly
            className="h-full min-h-[420px] font-mono text-xs bg-transparent border-0 text-gray-300 focus-visible:ring-0 resize-none p-4"
            placeholder="No output yet..."
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

