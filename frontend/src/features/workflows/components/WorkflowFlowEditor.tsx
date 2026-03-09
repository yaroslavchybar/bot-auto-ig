import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
} from '@/features/workflows/activities/index'
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
import type { Workflow } from '../types'

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
    localStorage.setItem(
      `${VIEWPORT_STORAGE_KEY}-${workflowId}`,
      JSON.stringify(viewport),
    )
  } catch {
    return
  }
}

export function WorkflowFlowEditor(props: WorkflowFlowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowFlowEditorInner
        key={`${props.workflow?._id ?? 'workflow'}-${props.open ? 'open' : 'closed'}`}
        {...props}
      />
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
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length === 1) {
        setSelectedNode(selectedNodes[0])
      } else {
        setSelectedNode(null)
      }
    },
    [],
  )

  // Update node data from settings panel
  const handleUpdateNode = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId ? { ...node, data: newData } : node,
        ),
      )
      // Update selected node reference
      setSelectedNode((prev) =>
        prev?.id === nodeId ? { ...prev, data: newData } : prev,
      )
    },
    [setNodes],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((prev) => addEdge(connection, prev))
    },
    [setEdges],
  )

  const onDragStart = useCallback(
    (event: React.DragEvent, activity: ActivityDefinition) => {
      event.dataTransfer.setData(
        'application/reactflow',
        JSON.stringify({
          activityId: activity.id,
          label: activity.name,
        }),
      )
      event.dataTransfer.effectAllowed = 'move'
    },
    [],
  )

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
      const reactFlowBounds = (event.target as HTMLElement)
        .closest('.react-flow')
        ?.getBoundingClientRect()
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
    [setNodes],
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
      <DialogContent className="border-line bg-shell text-ink flex h-screen w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 font-sans text-xs">
        <DialogHeader className="border-line bg-panel flex-none border-b p-0 shadow-xs">
          <div className="border-line-soft flex flex-col gap-2 border-b px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-0">
            <div className="flex min-w-0 items-center gap-2">
              <DialogTitle className="text-ink shrink-0 text-sm font-bold tracking-wider uppercase">
                Workflow Editor
              </DialogTitle>
              <span className="text-subtle-copy min-w-0 truncate font-mono text-xs">
                {workflow?.name || 'Workflow'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                className="border-line bg-field hover:bg-panel-hover h-6 rounded-[3px] px-2 py-0 font-sans text-[11px] text-copy shadow-none transition-none"
              >
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={saving}
                className="border-line bg-field hover:bg-panel-hover h-6 rounded-[3px] px-2 py-0 font-sans text-[11px] text-copy shadow-none transition-none"
              >
                <X className="mr-1.5 h-3 w-3" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
                className="brand-button h-6 rounded-[3px] px-2.5 text-[11px]"
              >
                <Save className="mr-1.5 h-3 w-3" />
                {saving ? 'Saving...' : 'Save Flow'}
              </Button>
            </div>
          </div>
          <div className="text-subtle-copy bg-field flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-[10px]">
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

        <div className="bg-shell flex min-h-0 flex-1">
          {/* Activity Palette Sidebar */}
          <div className="border-line bg-panel-subtle flex w-72 shrink-0 flex-col border-r">
            <div className="border-line-soft border-b px-4 py-3">
              <h3 className="text-ink text-xs font-bold tracking-wider uppercase">
                Activities
              </h3>
              <p className="text-subtle-copy mt-1 text-[10px]">
                Drag an item to the canvas
              </p>
            </div>
            <ScrollArea className="flex-1 bg-transparent">
              <div className="space-y-2 p-3">
                {categories.map((category) => {
                  const activities = getActivitiesByCategory(category)
                  const isExpanded = selectedCategory === category

                  return (
                    <div
                      key={category}
                      className="border-line-soft bg-panel-subtle overflow-hidden rounded-[4px] border"
                    >
                      <button
                        className={`hover:bg-panel-soft flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold ${isExpanded ? 'bg-panel-subtle text-ink' : 'text-muted-copy'}`}
                        onClick={() =>
                          setSelectedCategory(isExpanded ? null : category)
                        }
                      >
                        <span className="tracking-wide uppercase">
                          {getCategoryLabel(category)}
                        </span>
                        <span className="text-dim-copy font-mono text-[10px]">
                          {activities.length}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="border-line-soft space-y-1 border-t p-1.5 pt-1">
                          {activities.map((activity) => {
                            const Icon = iconMap[activity.icon] || HelpCircle
                            return (
                              <div
                                key={activity.id}
                                draggable
                                onDragStart={(e) => onDragStart(e, activity)}
                                className="border-line bg-panel hover:border-line-strong hover:bg-panel-muted flex cursor-grab items-center gap-2 rounded-[3px] border px-2 py-1.5 transition-colors active:cursor-grabbing"
                                title={activity.description}
                              >
                                <GripVertical className="text-dim-copy h-3 w-3" />
                                <div
                                  className="rounded-[2px] p-1"
                                  style={{
                                    backgroundColor: `${activity.color}20`,
                                  }}
                                >
                                  <Icon
                                    className="h-3.5 w-3.5"
                                    style={{ color: activity.color }}
                                  />
                                </div>
                                <span className="text-copy flex-1 truncate text-[11px]">
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
          <div className="relative min-h-0 flex-1">
            <div className="bg-shell absolute inset-0 overflow-hidden">
              <div className="border-line-soft bg-panel-subtle text-subtle-copy pointer-events-none absolute top-2 left-2 z-10 flex items-center rounded-md border px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase shadow-md backdrop-blur-xs">
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
                    style: { strokeWidth: 1.5, stroke: 'var(--workflow-edge)' },
                    markerEnd: {
                      type: MarkerType.ArrowClosed,
                      color: 'var(--workflow-edge)',
                    },
                  }}
                >
                  <Controls className="bg-panel-muted border-line" />
                  <Background gap={16} size={1} color="var(--workflow-grid)" />
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



