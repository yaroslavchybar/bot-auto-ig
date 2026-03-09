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
import type { Workflow } from '../types'

interface WorkflowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  workflow?: Workflow | null
  saving?: boolean
  onSave: (data: { name: string }) => void
  onCancel: () => void
}

export function WorkflowDialog({
  open,
  mode,
  workflow,
  ...props
}: WorkflowDialogProps) {
  const resetKey = `${mode}-${open ? workflow?._id ?? 'create' : 'closed'}`

  return (
    <WorkflowDialogInner
      key={resetKey}
      open={open}
      mode={mode}
      workflow={workflow}
      {...props}
    />
  )
}

function WorkflowDialogInner({
  open,
  onOpenChange,
  mode,
  workflow,
  saving,
  onSave,
  onCancel,
}: WorkflowDialogProps) {
  const [name, setName] = useState(
    mode === 'edit' && workflow ? workflow.name || '' : '',
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
            {mode === 'create' ? 'Create Workflow' : 'Edit Workflow'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workflow-name" className="text-muted-copy">
              Name
            </Label>
            <Input
              id="workflow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My workflow"
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
              className="border-line hover:bg-panel-hover text-copy bg-transparent"
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



