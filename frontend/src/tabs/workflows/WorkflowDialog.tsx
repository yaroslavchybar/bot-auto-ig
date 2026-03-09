import { useState, useEffect } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import type { Workflow } from './types'

interface WorkflowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  workflow?: Workflow | null
  saving?: boolean
  onSave: (data: { name: string; description?: string }) => void
  onCancel: () => void
}

export function WorkflowDialog({
  open,
  onOpenChange,
  mode,
  workflow,
  saving,
  onSave,
  onCancel,
}: WorkflowDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Reset form when dialog opens or workflow changes
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && workflow) {
        setName(workflow.name || '')
        setDescription(workflow.description || '')
      } else {
        setName('')
        setDescription('')
      }
    }
  }, [open, mode, workflow])

  const canSave = name.trim().length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
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

          <div className="space-y-2">
            <Label htmlFor="workflow-description" className="text-muted-copy">
              Description
            </Label>
            <Textarea
              id="workflow-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
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
