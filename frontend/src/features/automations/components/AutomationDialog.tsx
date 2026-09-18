import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Automation } from '../types'

interface AutomationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  automation?: Automation | null
  saving?: boolean
  onSave: (data: { name: string }) => void
  onCancel: () => void
}

export function AutomationDialog({
  open,
  mode,
  automation,
  ...props
}: AutomationDialogProps) {
  const resetKey = `${mode}-${open ? automation?._id ?? 'create' : 'closed'}`

  return (
    <AutomationDialogInner
      key={resetKey}
      open={open}
      mode={mode}
      automation={automation}
      {...props}
    />
  )
}

function AutomationDialogInner({
  open,
  onOpenChange,
  mode,
  automation,
  saving,
  onSave,
  onCancel,
}: AutomationDialogProps) {
  const [name, setName] = useState(
    mode === 'edit' && automation ? automation.name || '' : '',
  )

  const canSave = name.trim().length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return

    onSave({
      name: name.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-panel border-line text-ink border sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-ink">
            {mode === 'create' ? 'Create Automation' : 'Edit Automation'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="automation-name" className="text-muted-copy">
              Name
            </Label>
            <Input
              id="automation-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My automation"
              disabled={saving}
              className="brand-focus bg-field border-line text-ink"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSave || saving}
              className="brand-button"
            >
              {saving ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}



