import { useCallback, useEffect, useState } from 'react'
import type { Node } from 'reactflow'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { getActivityById, type ActivityInput } from '@/lib/activities/index'
import { X, Play, Settings2, MessageSquare, Plus, Trash2, Edit2, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { StartNodeData } from './StartNode'

interface NodeSettingsPanelProps {
	selectedNode: Node | null
	onUpdateNode: (nodeId: string, data: Record<string, unknown>) => void
	onClose: () => void
}

export function NodeSettingsPanel({
	selectedNode,
	onUpdateNode,
	onClose,
}: NodeSettingsPanelProps) {
	const lists = useQuery(api.lists.list, {})

	// Hide panel when no node selected
	if (!selectedNode) {
		return null
	}

	const isStartNode = selectedNode.type === 'start'

	if (isStartNode) {
		return (
			<StartNodeSettings
				node={selectedNode}
				lists={lists ?? []}
				onUpdate={onUpdateNode}
				onClose={onClose}
			/>
		)
	}

	return (
		<ActivityNodeSettings
			node={selectedNode}
			onUpdate={onUpdateNode}
			onClose={onClose}
		/>
	)
}

// ============================================================================
// Start Node Settings
// ============================================================================

interface StartNodeSettingsProps {
	node: Node
	lists: Array<{ _id: string; name: string }>
	onUpdate: (nodeId: string, data: Record<string, unknown>) => void
	onClose: () => void
}

function StartNodeSettings({ node, lists, onUpdate, onClose }: StartNodeSettingsProps) {
	const data = node.data as StartNodeData
	const [headlessMode, setHeadlessMode] = useState(data.headlessMode ?? false)
	const [cooldown, setCooldown] = useState(data.profileReopenCooldown ?? 30)
	const [messagingCooldown, setMessagingCooldown] = useState(data.messagingCooldown ?? 24)
	const [selectedLists, setSelectedLists] = useState<string[]>(data.sourceLists ?? [])

	// Sync local state when node changes
	useEffect(() => {
		setHeadlessMode(data.headlessMode ?? false)
		setCooldown(data.profileReopenCooldown ?? 30)
		setMessagingCooldown(data.messagingCooldown ?? 24)
		setSelectedLists(data.sourceLists ?? [])
	}, [node.id, data.headlessMode, data.profileReopenCooldown, data.messagingCooldown, data.sourceLists])

	const handleSave = useCallback(() => {
		onUpdate(node.id, {
			...data,
			headlessMode,
			profileReopenCooldown: cooldown,
			messagingCooldown,
			sourceLists: selectedLists,
		})
	}, [node.id, data, headlessMode, cooldown, messagingCooldown, selectedLists, onUpdate])

	const toggleList = useCallback((listId: string) => {
		setSelectedLists((prev) =>
			prev.includes(listId)
				? prev.filter((id) => id !== listId)
				: [...prev, listId]
		)
	}, [])

	return (
		<div className="w-72 border-l bg-muted/30 flex flex-col">
			<div className="p-3 border-b flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className="p-1.5 rounded bg-green-500/20">
						<Play className="w-4 h-4 text-green-500" />
					</div>
					<div>
						<h3 className="font-semibold text-sm">Start Node</h3>
						<p className="text-xs text-muted-foreground">Global Settings</p>
					</div>
				</div>
				<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
					<X className="h-4 w-4" />
				</Button>
			</div>

			<ScrollArea className="flex-1">
				<div className="p-4 space-y-4">
					{/* Headless Mode */}
					<div className="space-y-2">
						<div className="flex items-center space-x-2">
							<Checkbox
								id="headless"
								checked={headlessMode}
								onCheckedChange={(checked) => setHeadlessMode(!!checked)}
							/>
							<Label htmlFor="headless" className="text-sm font-medium">
								Headless Mode
							</Label>
						</div>
						<p className="text-xs text-muted-foreground pl-6">
							Run browser without visible window
						</p>
					</div>

					{/* Profile Reopen Cooldown */}
					<div className="space-y-2">
						<Label htmlFor="cooldown" className="text-sm font-medium">
							Profile Reopen Cooldown
						</Label>
						<div className="flex items-center gap-2">
							<Input
								id="cooldown"
								type="number"
								min={0}
								max={1440}
								value={cooldown}
								onChange={(e) => setCooldown(Number(e.target.value) || 0)}
								className="h-8"
							/>
							<span className="text-sm text-muted-foreground">min</span>
						</div>
						<p className="text-xs text-muted-foreground">
							Wait time before reopening same profile
						</p>
					</div>

					{/* Messaging Cooldown */}
					<div className="space-y-2">
						<Label htmlFor="messagingCooldown" className="text-sm font-medium">
							Messaging Cooldown
						</Label>
						<div className="flex items-center gap-2">
							<Input
								id="messagingCooldown"
								type="number"
								min={0}
								max={168}
								value={messagingCooldown}
								onChange={(e) => setMessagingCooldown(Number(e.target.value) || 0)}
								className="h-8"
							/>
							<span className="text-sm text-muted-foreground">hours</span>
						</div>
						<p className="text-xs text-muted-foreground">
							Wait time before messaging same user again
						</p>
					</div>

					{/* Source Lists */}
					<div className="space-y-2">
						<Label className="text-sm font-medium">Source Lists</Label>
						<p className="text-xs text-muted-foreground">
							Select lists to pull accounts from
						</p>
						<div className="border rounded-lg p-2 space-y-1 max-h-40 overflow-auto">
							{lists.length === 0 ? (
								<p className="text-xs text-muted-foreground text-center py-2">
									No lists available
								</p>
							) : (
								lists.map((list) => (
									<div key={list._id} className="flex items-center space-x-2">
										<Checkbox
											id={`list-${list._id}`}
											checked={selectedLists.includes(list._id)}
											onCheckedChange={() => toggleList(list._id)}
										/>
										<Label
											htmlFor={`list-${list._id}`}
											className="text-sm cursor-pointer flex-1"
										>
											{list.name}
										</Label>
									</div>
								))
							)}
						</div>
						{selectedLists.length > 0 && (
							<p className="text-xs text-muted-foreground">
								{selectedLists.length} list(s) selected
							</p>
						)}
					</div>
				</div>
			</ScrollArea>

			<div className="p-3 border-t">
				<Button className="w-full" size="sm" onClick={handleSave}>
					Apply Changes
				</Button>
			</div>
		</div>
	)
}

// ============================================================================
// Activity Node Settings
// ============================================================================

interface ActivityNodeSettingsProps {
	node: Node
	onUpdate: (nodeId: string, data: Record<string, unknown>) => void
	onClose: () => void
}

function ActivityNodeSettings({ node, onUpdate, onClose }: ActivityNodeSettingsProps) {
	const activityId = node.data?.activityId as string
	const activity = getActivityById(activityId)
	const initialConfig = (node.data?.config as Record<string, unknown>) || {}

	const [config, setConfig] = useState<Record<string, unknown>>(initialConfig)

	// Sync when node changes
	useEffect(() => {
		setConfig((node.data?.config as Record<string, unknown>) || {})
	}, [node.id, node.data?.config])

	const handleChange = useCallback((name: string, value: unknown) => {
		setConfig((prev) => ({ ...prev, [name]: value }))
	}, [])

	const handleSave = useCallback(() => {
		onUpdate(node.id, {
			...node.data,
			config,
		})
	}, [node.id, node.data, config, onUpdate])

	if (!activity) {
		return (
			<div className="w-72 border-l bg-muted/30 flex flex-col">
				<div className="p-3 border-b flex items-center justify-between">
					<h3 className="font-semibold text-sm">Unknown Activity</h3>
					<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
						<X className="h-4 w-4" />
					</Button>
				</div>
				<div className="p-4 text-sm text-muted-foreground">
					Activity "{activityId}" not found in registry
				</div>
			</div>
		)
	}

	return (
		<div className="w-72 border-l bg-muted/30 flex flex-col">
			<div className="p-3 border-b flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div
						className="p-1.5 rounded"
						style={{ backgroundColor: `${activity.color}20` }}
					>
						<Settings2 className="w-4 h-4" style={{ color: activity.color }} />
					</div>
					<div>
						<h3 className="font-semibold text-sm">{activity.name}</h3>
						<p className="text-xs text-muted-foreground">{activity.category}</p>
					</div>
				</div>
				<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
					<X className="h-4 w-4" />
				</Button>
			</div>

			<ScrollArea className="flex-1">
				<div className="p-4 space-y-4">
					<p className="text-xs text-muted-foreground">{activity.description}</p>

					{activity.inputs.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							This activity has no configurable inputs.
						</p>
					) : (
						<GroupedInputs
							inputs={activity.inputs}
							config={config}
							onChange={handleChange}
						/>
					)}
				</div>
			</ScrollArea>

			<div className="p-3 border-t">
				<Button className="w-full" size="sm" onClick={handleSave}>
					Apply Changes
				</Button>
			</div>
		</div>
	)
}

// ============================================================================
// Grouped Inputs Renderer
// ============================================================================

interface GroupedInputsProps {
	inputs: ActivityInput[]
	config: Record<string, unknown>
	onChange: (name: string, value: unknown) => void
}

function GroupedInputs({ inputs, config, onChange }: GroupedInputsProps) {
	// Separate grouped and ungrouped inputs
	const groups: Record<string, ActivityInput[]> = {}
	const ungrouped: ActivityInput[] = []

	for (const input of inputs) {
		if (input.group) {
			if (!groups[input.group]) groups[input.group] = []
			groups[input.group].push(input)
		} else {
			ungrouped.push(input)
		}
	}

	return (
		<>
			{/* Ungrouped inputs first */}
			{ungrouped.map((input) => (
				<InputField
					key={input.name}
					input={input}
					value={config[input.name]}
					onChange={(value) => onChange(input.name, value)}
					config={config}
				/>
			))}

			{/* Grouped inputs */}
			{Object.entries(groups).map(([groupName, groupInputs]) => (
				<div key={groupName} className="border-t pt-3">
					<Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
						{groupName}
					</Label>
					<div className="grid grid-cols-2 gap-2 mt-2">
						{groupInputs.map((input) => (
							<InputField
								key={input.name}
								input={input}
								value={config[input.name]}
								onChange={(value) => onChange(input.name, value)}
								compact
								config={config}
							/>
						))}
					</div>
				</div>
			))}
		</>
	)
}

// ============================================================================
// Input Field Renderer
// ============================================================================

interface InputFieldProps {
	input: ActivityInput
	value: unknown
	onChange: (value: unknown) => void
	compact?: boolean
	config?: Record<string, unknown>
}

function InputField({ input, value, onChange, compact, config }: InputFieldProps) {
	const displayValue = value ?? input.default ?? ''
	
	// Get template kind from config for template inputs
	const templateKind = (config?.template_kind as 'message' | 'message_2') || 'message'
	const templates = useQuery(
		api.messageTemplates.get,
		input.type === 'template' ? { kind: templateKind } : 'skip'
	) as string[] | undefined
	const upsertMutation = useMutation(api.messageTemplates.upsert)
	
	// Template editing state
	const [editingIndex, setEditingIndex] = useState<number | null>(null)
	const [editValue, setEditValue] = useState('')
	const [isCreating, setIsCreating] = useState(false)
	
	const handleSaveTemplate = async () => {
		const trimmed = editValue.trim()
		if (!trimmed || !templates) {
			setEditingIndex(null)
			setIsCreating(false)
			return
		}
		
		const next = [...templates]
		if (isCreating) {
			next.push(trimmed)
		} else if (editingIndex !== null) {
			next[editingIndex] = trimmed
		}
		
		try {
			await upsertMutation({ kind: templateKind, texts: next })
			setEditingIndex(null)
			setIsCreating(false)
			setEditValue('')
			toast.success('Template saved')
		} catch {
			toast.error('Failed to save template')
		}
	}
	
	const handleDeleteTemplate = async (index: number) => {
		if (!templates) return
		const next = [...templates]
		next.splice(index, 1)
		try {
			await upsertMutation({ kind: templateKind, texts: next })
			toast.success('Template deleted')
		} catch {
			toast.error('Failed to delete template')
		}
	}
	
	const startEditTemplate = (index: number) => {
		if (!templates) return
		setEditingIndex(index)
		setEditValue(templates[index])
		setIsCreating(false)
	}
	
	const startCreateTemplate = () => {
		setEditingIndex(null)
		setEditValue('')
		setIsCreating(true)
	}
	
	const cancelEditTemplate = () => {
		setEditingIndex(null)
		setEditValue('')
		setIsCreating(false)
	}

	switch (input.type) {
		case 'range':
			return (
				<div className={compact ? "space-y-1" : "space-y-1"}>
					<Label htmlFor={input.name} className="text-sm">
						{input.label}
					</Label>
					<div className="flex items-center gap-2">
						<Input
							id={input.name}
							type="range"
							min={input.min ?? 0}
							max={input.max ?? 100}
							step={input.step ?? 1}
							value={displayValue as number}
							onChange={(e) => onChange(Number(e.target.value))}
							className="flex-1 h-2"
						/>
						<span className="w-12 text-right text-sm text-muted-foreground">
							{String(displayValue)}{input.unit || ''}
						</span>
					</div>
					{input.helpText && (
						<p className="text-xs text-muted-foreground">{input.helpText}</p>
					)}
				</div>
			)

		case 'boolean':
			return (
				<div className="space-y-1">
					<div className="flex items-center space-x-2">
						<Checkbox
							id={input.name}
							checked={!!displayValue}
							onCheckedChange={(checked) => onChange(!!checked)}
						/>
						<Label htmlFor={input.name} className="text-sm">
							{input.label}
							{input.required && <span className="text-destructive">*</span>}
						</Label>
					</div>
					{input.helpText && (
						<p className="text-xs text-muted-foreground pl-6">{input.helpText}</p>
					)}
				</div>
			)

		case 'select':
			return (
				<div className="space-y-1">
					<Label htmlFor={input.name} className="text-sm">
						{input.label}
						{input.required && <span className="text-destructive">*</span>}
					</Label>
					<Select
						value={String(displayValue)}
						onValueChange={(v) => onChange(v)}
					>
						<SelectTrigger className="h-8">
							<SelectValue placeholder={input.placeholder || 'Select...'} />
						</SelectTrigger>
						<SelectContent>
							{input.options?.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{input.helpText && (
						<p className="text-xs text-muted-foreground">{input.helpText}</p>
					)}
				</div>
			)

		case 'number':
			return (
				<div className="space-y-1">
					<Label htmlFor={input.name} className="text-sm">
						{input.label}
						{input.unit && !compact && <span className="text-muted-foreground"> ({input.unit})</span>}
						{input.required && <span className="text-destructive">*</span>}
					</Label>
					<div className="flex items-center gap-1">
						<Input
							id={input.name}
							type="number"
							min={input.min}
							max={input.max}
							step={input.step}
							value={displayValue as number}
							onChange={(e) => onChange(Number(e.target.value))}
							placeholder={input.placeholder}
							className="h-8"
						/>
						{compact && input.unit && (
							<span className="text-xs text-muted-foreground w-8">{input.unit}</span>
						)}
					</div>
					{input.helpText && (
						<p className="text-xs text-muted-foreground">{input.helpText}</p>
					)}
				</div>
			)

		case 'template':
			return (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label className="text-sm">
							{input.label}
						</Label>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2"
							onClick={startCreateTemplate}
							disabled={isCreating || editingIndex !== null}
						>
							<Plus className="h-3 w-3 mr-1" />
							Add
						</Button>
					</div>
					
					{/* New template form */}
					{isCreating && (
						<div className="border border-primary rounded-lg p-2 space-y-2">
							<span className="text-xs font-medium text-primary">New Template</span>
							<Textarea
								value={editValue}
								onChange={(e) => setEditValue(e.target.value)}
								placeholder="Enter message..."
								className="min-h-[60px] text-xs"
							/>
							<div className="flex justify-end gap-1">
								<Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={cancelEditTemplate}>
									Cancel
								</Button>
								<Button size="sm" className="h-6 px-2 text-xs" onClick={handleSaveTemplate}>
									Save
								</Button>
							</div>
						</div>
					)}
					
					{templates === undefined ? (
						<div className="text-xs text-muted-foreground">Loading...</div>
					) : templates.length === 0 && !isCreating ? (
						<div className="border rounded-lg p-3 text-center">
							<MessageSquare className="h-6 w-6 mx-auto mb-1 opacity-30" />
							<p className="text-xs text-muted-foreground">No templates</p>
						</div>
					) : (
						<div className="space-y-1">
							{templates.map((template, index) => {
								if (editingIndex === index) {
									return (
										<div key={index} className="border border-primary rounded-lg p-2 space-y-2">
											<Textarea
												value={editValue}
												onChange={(e) => setEditValue(e.target.value)}
												className="min-h-[60px] text-xs"
											/>
											<div className="flex justify-end gap-1">
												<Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={cancelEditTemplate}>
													<X className="h-3 w-3" />
												</Button>
												<Button size="sm" className="h-6 px-2 text-xs" onClick={handleSaveTemplate}>
													<Save className="h-3 w-3" />
												</Button>
											</div>
										</div>
									)
								}
								return (
									<div key={index} className="border rounded-lg p-2 group hover:border-accent">
										<div className="flex items-start gap-2">
											<p className="text-xs text-muted-foreground flex-1 whitespace-pre-wrap break-words">
												{template.length > 80 ? template.slice(0, 80) + '...' : template}
											</p>
											<div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
												<Button
													variant="ghost"
													size="icon"
													className="h-6 w-6"
													onClick={() => startEditTemplate(index)}
												>
													<Edit2 className="h-3 w-3" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													className="h-6 w-6 text-destructive"
													onClick={() => handleDeleteTemplate(index)}
												>
													<Trash2 className="h-3 w-3" />
												</Button>
											</div>
										</div>
									</div>
								)
							})}
						</div>
					)}
					
					{input.helpText && (
						<p className="text-xs text-muted-foreground">{input.helpText}</p>
					)}
				</div>
			)

		case 'profile':
		case 'string':
		default:
			return (
				<div className="space-y-1">
					<Label htmlFor={input.name} className="text-sm">
						{input.label}
						{input.required && <span className="text-destructive">*</span>}
					</Label>
					<Input
						id={input.name}
						type="text"
						value={displayValue as string}
						onChange={(e) => onChange(e.target.value)}
						placeholder={input.placeholder}
						className="h-8"
					/>
					{input.helpText && (
						<p className="text-xs text-muted-foreground">{input.helpText}</p>
					)}
				</div>
			)
	}
}
