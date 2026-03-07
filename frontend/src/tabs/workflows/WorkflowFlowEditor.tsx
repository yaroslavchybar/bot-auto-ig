import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import ReactFlow, {
	Background,
	Controls,
	ReactFlowProvider,
	addEdge,
	useEdgesState,
	useNodesState,
	useReactFlow,
	MarkerType,
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
	List,
	Play,
	LogOut,
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
	List,
	Play,
	LogOut,
}

const nodeTypes: NodeTypes = {
	activity: ActivityNode,
	start: StartNode,
}

function DenseButton({ active, className, children, ...props }: ComponentProps<typeof Button> & { active?: boolean }) {
	return (
		<Button
			variant="outline"
			size="sm"
			className={`h-6 px-2 py-0 text-[11px] rounded-[3px] border-neutral-300 dark:border-neutral-600 font-sans shadow-none transition-none ${active ? 'bg-neutral-200 dark:bg-neutral-700 border-neutral-400 dark:border-neutral-500 font-medium text-neutral-900 dark:text-white' : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'} ${className || ''}`}
			{...props}
		>
			{children}
		</Button>
	)
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
			<DialogContent className="max-w-none w-screen h-screen p-0 flex flex-col gap-0 rounded-none border-white/10 bg-[#050505] text-gray-200 font-sans text-xs overflow-hidden">
				<DialogHeader className="p-0 border-b border-white/10 bg-[#0a0a0a] flex-none shadow-sm">
					<div className="flex flex-col md:flex-row md:items-center md:justify-between px-4 py-3 border-b border-white/5 gap-2 md:gap-0">
						<div className="flex items-center gap-2 min-w-0">
							<DialogTitle className="text-sm font-bold uppercase tracking-wider text-gray-200 shrink-0">
								Workflow Editor
							</DialogTitle>
							<span className="min-w-0 truncate text-xs text-gray-500 font-mono">
								{workflow?.name || 'Workflow'}
							</span>
						</div>
						<div className="flex items-center gap-1.5">
							<DenseButton onClick={handleClear} className="bg-transparent border-white/10 hover:bg-white/10 text-gray-300">
								Clear
							</DenseButton>
							<DenseButton onClick={onClose} disabled={saving} className="bg-transparent border-white/10 hover:bg-white/10 text-gray-300">
								<X className="mr-1.5 h-3 w-3" />
								Cancel
							</DenseButton>
							<Button size="sm" onClick={handleSave} disabled={saving} className="h-6 px-2.5 rounded-[3px] text-[11px] bg-gradient-to-r from-red-600 to-orange-500 border-none shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] text-white">
								<Save className="mr-1.5 h-3 w-3" />
								{saving ? 'Saving...' : 'Save Flow'}
							</Button>
						</div>
					</div>
					<div className="px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500 bg-black/50">
						<div className="flex items-center gap-3">
							<span>{nodes.length} Nodes</span>
							<span>{edges.length} Edges</span>
						</div>
						<div className="flex items-center gap-3 font-mono">
							<span>Del: Remove Selection</span>
							<span>Drag: Add Activity</span>
						</div>
					</div>
				</DialogHeader>

				<div className="flex-1 flex min-h-0 bg-[#050505]">
					{/* Activity Palette Sidebar */}
					<div className="w-72 border-r border-white/10 flex flex-col bg-white/[0.02] shrink-0">
						<div className="px-4 py-3 border-b border-white/5">
							<h3 className="text-xs font-bold uppercase tracking-wider text-gray-200">Activities</h3>
							<p className="text-[10px] text-gray-500 mt-1">Drag an item to the canvas</p>
						</div>
						<ScrollArea className="flex-1 bg-transparent">
							<div className="p-3 space-y-2">
								{categories.map((category) => {
									const activities = getActivitiesByCategory(category)
									const isExpanded = selectedCategory === category

									return (
										<div key={category} className="border border-white/5 rounded-[4px] overflow-hidden bg-white/[0.01]">
											<button
												className={`w-full px-3 py-2 text-left text-[11px] font-semibold hover:bg-white/[0.03] flex items-center justify-between ${isExpanded ? 'bg-white/[0.02] text-gray-200' : 'text-gray-400'}`}
												onClick={() => setSelectedCategory(isExpanded ? null : category)}
											>
												<span className="uppercase tracking-wide">{getCategoryLabel(category)}</span>
												<span className="text-[10px] font-mono text-gray-600">
													{activities.length}
												</span>
											</button>
											{isExpanded && (
												<div className="p-1.5 pt-1 border-t border-white/5 space-y-1">
													{activities.map((activity) => {
														const Icon = iconMap[activity.icon] || HelpCircle
														return (
															<div
																key={activity.id}
																draggable
																onDragStart={(e) => onDragStart(e, activity)}
																className="flex items-center gap-2 px-2 py-1.5 rounded-[3px] border border-white/10 bg-[#0a0a0a] cursor-grab active:cursor-grabbing hover:border-white/20 hover:bg-white/[0.05] transition-colors"
																title={activity.description}
															>
																<GripVertical className="w-3 h-3 text-gray-600" />
																<div
																	className="p-1 rounded-[2px]"
																	style={{ backgroundColor: `${activity.color}20` }}
																>
																	<Icon
																		className="w-3.5 h-3.5"
																		style={{ color: activity.color }}
																	/>
																</div>
																<span className="text-[11px] truncate flex-1 text-gray-300">
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
					<div className="flex-1 min-h-0 relative">
						<div className="absolute inset-0 bg-[#050505] overflow-hidden">
							<div className="absolute top-2 left-2 z-10 px-3 py-1.5 rounded-md border border-white/5 bg-white/[0.02] text-[10px] uppercase font-semibold tracking-wider text-gray-500 flex items-center shadow-md backdrop-blur-sm pointer-events-none">
								Flow Canvas
							</div>
							<div
								className="h-full w-full"
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
									className="bg-transparent"
									selectNodesOnDrag={false}
									defaultEdgeOptions={{
										type: 'bezier',
										style: { strokeWidth: 1.5, stroke: '#94a3b8' },
										markerEnd: {
											type: MarkerType.ArrowClosed,
											color: '#94a3b8',
										},
									}}
								>
									<Controls className="bg-white/5 border-white/10" />
									<Background gap={16} size={1} color="#333" />
								</ReactFlow>
							</div>
						</div>
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
