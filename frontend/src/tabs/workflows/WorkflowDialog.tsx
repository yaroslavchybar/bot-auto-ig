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
	onSave: (data: {
		name: string
		description?: string
	}) => void
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
			<DialogContent className="sm:max-w-[500px] bg-[#0a0a0a] border border-white/10 text-gray-200">
				<DialogHeader>
					<DialogTitle className="text-gray-200">
						{mode === 'create' ? 'Create Workflow' : 'Edit Workflow'}
					</DialogTitle>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="workflow-name" className="text-gray-400">Name</Label>
						<Input
							id="workflow-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My workflow"
							disabled={saving}
							className="bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="workflow-description" className="text-gray-400">Description</Label>
						<Textarea
							id="workflow-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Optional description..."
							rows={3}
							disabled={saving}
							className="bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
						/>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={onCancel}
							disabled={saving}
							className="bg-transparent border-white/10 hover:bg-white/10 text-gray-300"
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!canSave || saving} className="bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 text-white border-0 shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)]">
							{saving ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
