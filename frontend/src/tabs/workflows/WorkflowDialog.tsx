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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
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
		category?: string
	}) => void
	onCancel: () => void
}

const CATEGORIES = [
	{ value: 'warmup', label: 'Warmup' },
	{ value: 'outreach', label: 'Outreach' },
	{ value: 'engagement', label: 'Engagement' },
	{ value: 'maintenance', label: 'Maintenance' },
	{ value: 'other', label: 'Other' },
]

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
	const [category, setCategory] = useState<string>('')

	// Reset form when dialog opens or workflow changes
	useEffect(() => {
		if (open) {
			if (mode === 'edit' && workflow) {
				setName(workflow.name || '')
				setDescription(workflow.description || '')
				setCategory(workflow.category || '')
			} else {
				setName('')
				setDescription('')
				setCategory('')
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
			category: category || undefined,
		})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						{mode === 'create' ? 'Create Workflow' : 'Edit Workflow'}
					</DialogTitle>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="workflow-name">Name</Label>
						<Input
							id="workflow-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My workflow"
							disabled={saving}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="workflow-description">Description</Label>
						<Textarea
							id="workflow-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Optional description..."
							rows={3}
							disabled={saving}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="workflow-category">Category</Label>
						<Select value={category} onValueChange={setCategory} disabled={saving}>
							<SelectTrigger id="workflow-category">
								<SelectValue placeholder="Select category..." />
							</SelectTrigger>
							<SelectContent>
								{CATEGORIES.map((cat) => (
									<SelectItem key={cat.value} value={cat.value}>
										{cat.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
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
						<Button type="submit" disabled={!canSave || saving}>
							{saving ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
