import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
	Background,
	Controls,
	ReactFlowProvider,
	addEdge,
	useEdgesState,
	useNodesState,
	useReactFlow,
	type Connection,
	type Edge,
	type Node,
	type NodeTypes,
	type OnSelectionChangeParams,
	type Viewport,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import {
	getAllCategories,
	getActivitiesByCategory,
	getCategoryLabel,
	getDefaultConfig,
	type ActivityDefinition,
} from '@/lib/activities/index'
import { ActivityNode } from './ActivityNode'
import { StartNode, DEFAULT_START_DATA } from './StartNode'
import { NodeSettingsPanel } from './NodeSettingsPanel'
import {
	Scroll,
	Film,
	UserPlus,
	UserMinus,
	UserCheck,
	MessageCircle,
	Inbox,
	CircleDot,
	Clock,
	GitBranch,
	Repeat,
	GitFork,
	HelpCircle,
	Save,
	X,
	GripVertical,
} from 'lucide-react'
import type { Workflow } from './types'

const iconMap: Record<string, React.ElementType> = {
	Scroll,
	Film,
	UserPlus,
	UserMinus,
	UserCheck,
	MessageCircle,
	Inbox,
	CircleDot,
	Clock,
	GitBranch,
	Repeat,
	GitFork,
}

const nodeTypes: NodeTypes = {
	activity: ActivityNode,
	start: StartNode,
}

interface WorkflowFlowEditorProps {
	open: boolean
	workflow: Workflow | null
	saving?: boolean
	onSave: (nodes: Node[], edges: Edge[]) => void
	onClose: () => void
}

const VIEWPORT_STORAGE_KEY = 'workflow-editor-viewport'

function getStoredViewport(workflowId: string): Viewport | null {
	try {
		const stored = localStorage.getItem(`${VIEWPORT_STORAGE_KEY}-${workflowId}`)
		if (stored) return JSON.parse(stored)
	} catch {
		return null
	}
	return null
}

function saveViewport(workflowId: string, viewport: Viewport) {
	try {
		localStorage.setItem(`${VIEWPORT_STORAGE_KEY}-${workflowId}`, JSON.stringify(viewport))
	} catch {
		return
	}
}

export function WorkflowFlowEditor(props: WorkflowFlowEditorProps) {
	return (
		<ReactFlowProvider>
			<WorkflowFlowEditorInner {...props} />
		</ReactFlowProvider>
	)
}

function WorkflowFlowEditorInner({
	open,
	workflow,
	saving,
	onSave,
	onClose,
}: WorkflowFlowEditorProps) {
	const { setViewport, getViewport } = useReactFlow()
	const viewportRestored = useRef(false)
	// Initialize from workflow or with a start node
	const initialNodes = useMemo(() => {
		if (workflow?.nodes && (workflow.nodes as Node[]).length > 0) {
			return workflow.nodes as Node[]
		}
		// Create default start node if none exists
		return [
			{
				id: 'start_node',
				type: 'start',
				position: { x: 250, y: 50 },
				data: { ...DEFAULT_START_DATA },
			},
		]
	}, [workflow])

	const initialEdges = useMemo(() => {
		if (!workflow?.edges) return []
		return (workflow.edges as Edge[]) || []
	}, [workflow])

	const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
	const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
	const [selectedNode, setSelectedNode] = useState<Node | null>(null)

	// Reset when workflow changes
	useEffect(() => {
		if (open) {
			if (workflow?.nodes && (workflow.nodes as Node[]).length > 0) {
				setNodes(workflow.nodes as Node[])
			} else {
				setNodes([
					{
						id: 'start_node',
						type: 'start',
						position: { x: 250, y: 50 },
						data: { ...DEFAULT_START_DATA },
					},
				])
			}
			setEdges((workflow?.edges as Edge[]) || [])
			setSelectedNode(null)
			viewportRestored.current = false
		}
	}, [open, workflow, setNodes, setEdges])

	// Restore viewport from localStorage after nodes are set
	useEffect(() => {
		if (open && workflow?._id && !viewportRestored.current) {
			const stored = getStoredViewport(workflow._id)
			if (stored) {
				// Small delay to ensure ReactFlow is ready
				setTimeout(() => setViewport(stored, { duration: 0 }), 50)
			}
			viewportRestored.current = true
		}
	}, [open, workflow?._id, setViewport])

	// Save viewport on move/zoom
	const onMoveEnd = useCallback(() => {
		if (workflow?._id) {
			saveViewport(workflow._id, getViewport())
		}
	}, [workflow, getViewport])

	// Handle node selection
	const onSelectionChange = useCallback(({ nodes: selectedNodes }: OnSelectionChangeParams) => {
		if (selectedNodes.length === 1) {
			setSelectedNode(selectedNodes[0])
		} else {
			setSelectedNode(null)
		}
	}, [])

	// Update node data from settings panel
	const handleUpdateNode = useCallback((nodeId: string, newData: Record<string, unknown>) => {
		setNodes((nds) =>
			nds.map((node) =>
				node.id === nodeId ? { ...node, data: newData } : node
			)
		)
		// Update selected node reference
		setSelectedNode((prev) =>
			prev?.id === nodeId ? { ...prev, data: newData } : prev
		)
	}, [setNodes])

	const onConnect = useCallback(
		(connection: Connection) => {
			setEdges((prev) => addEdge(connection, prev))
		},
		[setEdges]
	)

	const onDragStart = useCallback((event: React.DragEvent, activity: ActivityDefinition) => {
		event.dataTransfer.setData('application/reactflow', JSON.stringify({
			activityId: activity.id,
			label: activity.name,
		}))
		event.dataTransfer.effectAllowed = 'move'
	}, [])

	const onDragOver = useCallback((event: React.DragEvent) => {
		event.preventDefault()
		event.dataTransfer.dropEffect = 'move'
	}, [])

	const onDrop = useCallback(
		(event: React.DragEvent) => {
			event.preventDefault()

			const data = event.dataTransfer.getData('application/reactflow')
			if (!data) return

			const { activityId, label } = JSON.parse(data)
			const reactFlowBounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect()
			if (!reactFlowBounds) return

			const position = {
				x: event.clientX - reactFlowBounds.left - 80,
				y: event.clientY - reactFlowBounds.top - 30,
			}

			const newNode: Node = {
				id: `${activityId}_${Date.now()}`,
				type: 'activity',
				position,
				data: {
					activityId,
					label,
					config: getDefaultConfig(activityId),
				},
			}

			setNodes((nds) => [...nds, newNode])
		},
		[setNodes]
	)

	const handleSave = useCallback(() => {
		onSave(nodes, edges)
	}, [nodes, edges, onSave])

	const handleClear = useCallback(() => {
		// Keep start node, clear others
		setNodes([
			{
				id: 'start_node',
				type: 'start',
				position: { x: 250, y: 50 },
				data: { ...DEFAULT_START_DATA },
			},
		])
		setEdges([])
		setSelectedNode(null)
	}, [setNodes, setEdges])

	const categories = getAllCategories()

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="max-w-none w-screen h-screen p-0 flex flex-col gap-0 rounded-none">
				<DialogHeader className="p-4 border-b flex-none">
					<DialogTitle className="flex items-center justify-between">
						<span>Edit Flow: {workflow?.name || 'Workflow'}</span>
						<div className="flex items-center gap-2">
							<Button variant="outline" size="sm" onClick={handleClear}>
								Clear All
							</Button>
							<Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
								<X className="mr-2 h-4 w-4" />
								Cancel
							</Button>
							<Button size="sm" onClick={handleSave} disabled={saving}>
								<Save className="mr-2 h-4 w-4" />
								{saving ? 'Saving...' : 'Save Flow'}
							</Button>
						</div>
					</DialogTitle>
				</DialogHeader>

				<div className="flex-1 flex min-h-0">
					{/* Activity Palette Sidebar */}
					<div className="w-64 border-r flex flex-col bg-muted/30">
						<div className="p-3 border-b">
							<h3 className="font-semibold text-sm">Activities</h3>
							<p className="text-xs text-muted-foreground">Drag to canvas</p>
						</div>
						<ScrollArea className="flex-1">
							<div className="p-2 space-y-1">
								{categories.map((category) => {
									const activities = getActivitiesByCategory(category)
									const isExpanded = selectedCategory === category

									return (
										<div key={category}>
											<button
												className="w-full px-2 py-1.5 text-left text-sm font-medium hover:bg-muted rounded flex items-center justify-between"
												onClick={() => setSelectedCategory(isExpanded ? null : category)}
											>
												{getCategoryLabel(category)}
												<span className="text-xs text-muted-foreground">
													{activities.length}
												</span>
											</button>
											{isExpanded && (
												<div className="ml-2 mt-1 space-y-1">
													{activities.map((activity) => {
														const Icon = iconMap[activity.icon] || HelpCircle
														return (
															<div
																key={activity.id}
																draggable
																onDragStart={(e) => onDragStart(e, activity)}
																className="flex items-center gap-2 px-2 py-2 rounded border bg-background cursor-grab hover:border-primary/50 hover:shadow-sm transition-all"
																title={activity.description}
															>
																<GripVertical className="w-3 h-3 text-muted-foreground" />
																<div
																	className="p-1 rounded"
																	style={{ backgroundColor: `${activity.color}20` }}
																>
																	<Icon
																		className="w-3.5 h-3.5"
																		style={{ color: activity.color }}
																	/>
																</div>
																<span className="text-sm truncate flex-1">
																	{activity.name}
																</span>
															</div>
														)
													})}
												</div>
											)}
										</div>
									)
								})}
							</div>
						</ScrollArea>
					</div>

					{/* Flow Canvas */}
					<div
						className="flex-1 min-h-0"
						onDragOver={onDragOver}
						onDrop={onDrop}
					>
						<ReactFlow
							nodes={nodes}
							edges={edges}
							onNodesChange={onNodesChange}
							onEdgesChange={onEdgesChange}
							onConnect={onConnect}
							onSelectionChange={onSelectionChange}
							onMoveEnd={onMoveEnd}
							nodeTypes={nodeTypes}
							fitView={!getStoredViewport(workflow?._id || '')}
							deleteKeyCode={['Backspace', 'Delete']}
							className="bg-background"
							selectNodesOnDrag={false}
						>
							<Controls />
							<Background gap={16} size={1} />
						</ReactFlow>
					</div>

					{/* Node Settings Panel */}
					<NodeSettingsPanel
						selectedNode={selectedNode}
						onUpdateNode={handleUpdateNode}
						onClose={() => setSelectedNode(null)}
					/>
				</div>
			</DialogContent>
		</Dialog>
	)
}
