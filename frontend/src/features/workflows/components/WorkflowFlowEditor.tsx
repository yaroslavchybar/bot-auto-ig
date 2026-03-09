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
  MarkerType,
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
import { Grid3X3, Plus, Save, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Workflow } from '../types'
import { ActivityNode } from './ActivityNode'
import { BlockLibraryDialog } from './BlockLibraryDialog'
import { NodeSettingsPanel } from './NodeSettingsPanel'
import { StartNode, DEFAULT_START_DATA } from './StartNode'
import {
  WorkflowEditorProvider,
  type WorkflowEditorContextValue,
} from './WorkflowEditorContext'
import {
  createActivityNode,
  createEdgeId,
  duplicateWorkflowNode,
  getConnectedInsertPosition,
  getDisconnectedInsertPosition,
  removeNodeEdges,
  selectOnlyNode,
  type BlockInsertionContext,
} from './workflowEditorUtils'

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

function createDefaultStartNode(): Node {
  return {
    id: 'start_node',
    type: 'start',
    position: { x: 250, y: 50 },
    data: { ...DEFAULT_START_DATA },
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
  const { getViewport, setViewport } = useReactFlow()
  const viewportRestored = useRef(false)
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const initialNodes = useMemo(() => {
    if (workflow?.nodes && (workflow.nodes as Node[]).length > 0) {
      return (workflow.nodes as Node[]).map((node) => ({
        ...node,
        selected: false,
      }))
    }

    return [createDefaultStartNode()]
  }, [workflow])

  const initialEdges = useMemo(() => {
    if (!workflow?.edges) return []
    return (workflow.edges as Edge[]) || []
  }, [workflow])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [blockLibraryOpen, setBlockLibraryOpen] = useState(false)
  const [blockLibraryContext, setBlockLibraryContext] =
    useState<BlockInsertionContext | null>(null)

  useEffect(() => {
    if (open && workflow?._id && !viewportRestored.current) {
      const stored = getStoredViewport(workflow._id)
      if (stored) {
        window.setTimeout(() => setViewport(stored, { duration: 0 }), 50)
      }
      viewportRestored.current = true
    }
  }, [open, setViewport, workflow?._id])

  const onMoveEnd = useCallback(() => {
    if (workflow?._id) {
      saveViewport(workflow._id, getViewport())
    }
  }, [getViewport, workflow])

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length === 1) {
        setSelectedNode(selectedNodes[0])
        return
      }

      setSelectedNode(null)
    },
    [],
  )

  const focusNode = useCallback(
    (nodeId: string) => {
      const matchedNode = nodes.find((node) => node.id === nodeId) ?? null
      setNodes((prev) => selectOnlyNode(prev, nodeId))
      setSelectedNode(
        matchedNode
          ? {
              ...matchedNode,
              selected: true,
            }
          : null,
      )
    },
    [nodes, setNodes],
  )

  const handleUpdateNode = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId ? { ...node, data: newData } : node,
        ),
      )
      setSelectedNode((prev) =>
        prev?.id === nodeId ? { ...prev, data: newData } : prev,
      )
    },
    [setNodes],
  )

  const insertActivity = useCallback(
    (activityId: string, insertionContext: BlockInsertionContext) => {
      const sourceNode =
        insertionContext.sourceNodeId != null
          ? nodes.find((node) => node.id === insertionContext.sourceNodeId) ??
            null
          : null

      const nextPosition =
        insertionContext.disconnected || !sourceNode
          ? getDisconnectedInsertPosition({
              viewport: getViewport(),
              canvasHeight: canvasRef.current?.clientHeight ?? 720,
              canvasWidth: canvasRef.current?.clientWidth ?? 1200,
              existingNodes: nodes,
            })
          : getConnectedInsertPosition(sourceNode, insertionContext.sourceHandle)

      const newNode = createActivityNode(activityId, nextPosition)
      setNodes((prev) => selectOnlyNode([...prev, newNode], newNode.id))
      setSelectedNode({ ...newNode, selected: true })

      if (!insertionContext.disconnected && sourceNode) {
        const edgeSourceHandle = insertionContext.sourceHandle || undefined
        setEdges((prev) =>
          addEdge(
            {
              id: createEdgeId(sourceNode.id, newNode.id, edgeSourceHandle),
              source: sourceNode.id,
              target: newNode.id,
              ...(edgeSourceHandle ? { sourceHandle: edgeSourceHandle } : {}),
            },
            prev,
          ),
        )
      }

      setBlockLibraryOpen(false)
      setBlockLibraryContext(null)
    },
    [getViewport, nodes, setEdges, setNodes],
  )

  const openBlockLibrary = useCallback((insertionContext: BlockInsertionContext) => {
    setBlockLibraryContext(insertionContext)
    setBlockLibraryOpen(true)
  }, [])

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (nodeId === 'start_node') return

      setNodes((prev) => prev.filter((node) => node.id !== nodeId))
      setEdges((prev) => removeNodeEdges(prev, nodeId))
      setSelectedNode((prev) => (prev?.id === nodeId ? null : prev))
    },
    [setEdges, setNodes],
  )

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const sourceNode = nodes.find((node) => node.id === nodeId)
      if (!sourceNode || sourceNode.id === 'start_node') return

      const clonedNode = duplicateWorkflowNode(sourceNode)
      setNodes((prev) => selectOnlyNode([...prev, clonedNode], clonedNode.id))
      setSelectedNode({ ...clonedNode, selected: true })
    },
    [nodes, setNodes],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((prev) => addEdge(connection, prev))
    },
    [setEdges],
  )

  const handleSave = useCallback(() => {
    onSave(nodes, edges)
  }, [edges, nodes, onSave])

  const handleClear = useCallback(() => {
    setNodes([createDefaultStartNode()])
    setEdges([])
    setSelectedNode(null)
    setBlockLibraryOpen(false)
    setBlockLibraryContext(null)
  }, [setEdges, setNodes])

  const handleOpenDisconnectedLibrary = useCallback(() => {
    setBlockLibraryContext({ disconnected: true })
    setBlockLibraryOpen(true)
  }, [])

  const handleCloseSettings = useCallback(() => {
    setNodes((prev) => selectOnlyNode(prev, null))
    setSelectedNode(null)
  }, [setNodes])

  const handleBlockLibraryOpenChange = useCallback((nextOpen: boolean) => {
    setBlockLibraryOpen(nextOpen)
    if (!nextOpen) {
      setBlockLibraryContext(null)
    }
  }, [])

  const editorContextValue = useMemo<WorkflowEditorContextValue>(
    () => ({
      insertActivity,
      openBlockLibrary,
      duplicateNode,
      deleteNode,
      focusNode,
    }),
    [deleteNode, duplicateNode, focusNode, insertActivity, openBlockLibrary],
  )

  const hasStoredViewport = Boolean(getStoredViewport(workflow?._id || ''))
  const isEmptyCanvas =
    nodes.length === 1 && nodes[0]?.id === 'start_node' && edges.length === 0

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="border-line bg-shell text-ink flex h-screen w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 font-sans text-xs"
        hideClose
      >
        <DialogHeader className="border-line bg-panel flex-none border-b p-0 shadow-xs">
          <div className="border-line-soft flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <DialogTitle className="text-ink shrink-0 text-sm font-bold tracking-wider uppercase">
                Workflow Editor
              </DialogTitle>
              <span className="text-subtle-copy min-w-0 truncate font-mono text-xs">
                {workflow?.name || 'Workflow'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenDisconnectedLibrary}
                disabled={saving}
                className="border-line bg-field hover:bg-panel-hover h-6 rounded-[3px] px-2 py-0 font-sans text-[11px] text-copy shadow-none transition-none"
              >
                <Plus className="mr-1.5 h-3 w-3" />
                Add Block
              </Button>
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
              <span>Click +: Insert next block</span>
              <span>Drag handles: Reconnect paths</span>
              <span>Del: Remove selection</span>
            </div>
          </div>
        </DialogHeader>

        <WorkflowEditorProvider value={editorContextValue}>
          <div className="bg-shell flex min-h-0 flex-1">
            <div className="relative min-h-0 flex-1">
              <div
                ref={canvasRef}
                className="bg-shell absolute inset-0 overflow-hidden"
              >
                <div className="border-line-soft bg-panel-subtle text-subtle-copy pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase shadow-md backdrop-blur-xs">
                  <Grid3X3 className="h-3.5 w-3.5" />
                  Flow Canvas
                </div>

                {isEmptyCanvas ? (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
                    <div className="bg-panel/92 border-line max-w-sm rounded-2xl border p-5 text-center shadow-xl backdrop-blur-sm">
                      <div className="bg-panel-subtle mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl">
                        <Sparkles className="text-ink h-5 w-5" />
                      </div>
                      <h3 className="text-ink text-sm font-semibold">
                        Start building from the entry node
                      </h3>
                      <p className="text-subtle-copy mt-2 text-xs leading-relaxed">
                        Click the <strong>+</strong> button on the start node to
                        add the first block, or use the header action to place a
                        disconnected block.
                      </p>
                    </div>
                  </div>
                ) : null}

                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onSelectionChange={onSelectionChange}
                  onMoveEnd={onMoveEnd}
                  nodeTypes={nodeTypes}
                  fitView={!hasStoredViewport}
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

            <NodeSettingsPanel
              selectedNode={selectedNode}
              onUpdateNode={handleUpdateNode}
              onClose={handleCloseSettings}
            />
          </div>

          <BlockLibraryDialog
            open={blockLibraryOpen}
            insertionContext={blockLibraryContext}
            onOpenChange={handleBlockLibraryOpenChange}
          />
        </WorkflowEditorProvider>
      </DialogContent>
    </Dialog>
  )
}
