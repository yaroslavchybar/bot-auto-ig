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
  type Connection,
  type Edge,
  type Node,
  type EdgeTypes,
  type NodeTypes,
  type OnSelectionChangeParams,
  type Viewport,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { ArrowLeft, Plus, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { Workflow } from '../types'
import { ActivityNode } from './ActivityNode'
import { BlockLibraryDialog } from './BlockLibraryDialog'
import { NodeSettingsPanel } from './NodeSettingsPanel'
import { StartNode, DEFAULT_START_DATA } from './StartNode'
import { WorkflowEdge, WORKFLOW_EDGE_DEFAULTS } from './WorkflowEdge'
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
  normalizeWorkflowNode,
  removeNodeEdges,
  selectOnlyNode,
  type BlockInsertionContext,
} from './workflowEditorUtils'
import { rememberRecentActivity } from '../utils/recentActivities'

const nodeTypes: NodeTypes = {
  activity: ActivityNode,
  start: StartNode,
}

const edgeTypes: EdgeTypes = {
  workflow: WorkflowEdge,
}

interface WorkflowFlowEditorProps {
  workflow: Workflow | null
  saving?: boolean
  onSave: (nodes: Node[], edges: Edge[]) => void
  onClose: () => void
}

const VIEWPORT_STORAGE_KEY = 'workflow-editor-viewport'
const DELETE_UNDO_DURATION_MS = 5000

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

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
        key={props.workflow?._id ?? 'workflow'}
        {...props}
      />
    </ReactFlowProvider>
  )
}

function WorkflowFlowEditorInner({
  workflow,
  saving,
  onSave,
  onClose,
}: WorkflowFlowEditorProps) {
  const { getViewport, setViewport } = useReactFlow()
  const viewportRestored = useRef(false)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef<Node[]>([])
  const edgesRef = useRef<Edge[]>([])
  const deleteToastIdRef = useRef<string | number | null>(null)

  const initialNodes = useMemo(() => {
    if (workflow?.nodes && (workflow.nodes as Node[]).length > 0) {
      return (workflow.nodes as Node[]).map((node) => ({
        ...normalizeWorkflowNode(node),
        selected: false,
      }))
    }

    return [createDefaultStartNode()]
  }, [workflow])

  const initialEdges = useMemo(() => {
    if (!workflow?.edges) return []
    return ((workflow.edges as Edge[]) || []).map((edge) => ({
      ...WORKFLOW_EDGE_DEFAULTS,
      ...edge,
      style: {
        ...WORKFLOW_EDGE_DEFAULTS.style,
        ...edge.style,
      },
      markerEnd: edge.markerEnd ?? WORKFLOW_EDGE_DEFAULTS.markerEnd,
      type: 'workflow',
    }))
  }, [workflow])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [blockLibraryOpen, setBlockLibraryOpen] = useState(false)
  const [blockLibraryContext, setBlockLibraryContext] =
    useState<BlockInsertionContext | null>(null)
  const [quickAddMenuOpen, setQuickAddMenuOpen] = useState(false)
  const [pendingDeleteNodeId, setPendingDeleteNodeId] = useState<string | null>(
    null,
  )

  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [edges, nodes])

  useEffect(() => {
    if (workflow?._id && !viewportRestored.current) {
      const stored = getStoredViewport(workflow._id)
      if (stored) {
        window.setTimeout(() => setViewport(stored, { duration: 0 }), 50)
      }
      viewportRestored.current = true
    }
  }, [setViewport, workflow?._id])

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
      rememberRecentActivity(activityId)
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
              ...WORKFLOW_EDGE_DEFAULTS,
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

  const restoreDeletedNode = useCallback(
    (deletedNode: Node, deletedEdges: Edge[]) => {
      const currentNodes = nodesRef.current

      if (currentNodes.some((node) => node.id === deletedNode.id)) {
        return
      }

      const restoredNode = { ...deletedNode, selected: true }
      const restoredNodes = selectOnlyNode([...currentNodes, restoredNode], deletedNode.id)
      const restoredNodeIds = new Set(restoredNodes.map((node) => node.id))
      const currentEdges = edgesRef.current
      const currentEdgeIds = new Set(currentEdges.map((edge) => edge.id))
      const restoredEdges = deletedEdges.filter(
        (edge) =>
          !currentEdgeIds.has(edge.id) &&
          restoredNodeIds.has(edge.source) &&
          restoredNodeIds.has(edge.target),
      )

      setNodes(restoredNodes)
      setEdges([...currentEdges, ...restoredEdges])
      setSelectedNode(restoredNode)
    },
    [setEdges, setNodes],
  )

  const performDeleteNode = useCallback(
    (nodeId: string) => {
      if (nodeId === 'start_node') return

      const currentNodes = nodesRef.current
      const currentEdges = edgesRef.current
      const nodeToDelete = currentNodes.find((node) => node.id === nodeId)

      if (!nodeToDelete) {
        return
      }

      const deletedEdges = currentEdges.filter(
        (edge) => edge.source === nodeId || edge.target === nodeId,
      )

      if (deleteToastIdRef.current != null) {
        toast.dismiss(deleteToastIdRef.current)
      }

      setNodes(currentNodes.filter((node) => node.id !== nodeId))
      setEdges(removeNodeEdges(currentEdges, nodeId))
      setSelectedNode((prev) => (prev?.id === nodeId ? null : prev))

      deleteToastIdRef.current = toast('Node deleted', {
        description: 'You can undo this deletion for the next 5 seconds.',
        duration: DELETE_UNDO_DURATION_MS,
        position: 'bottom-left',
        action: {
          label: 'Undo',
          onClick: () => restoreDeletedNode(nodeToDelete, deletedEdges),
        },
        onDismiss: () => {
          deleteToastIdRef.current = null
        },
        onAutoClose: () => {
          deleteToastIdRef.current = null
        },
      })
    },
    [restoreDeletedNode, setEdges, setNodes],
  )

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (nodeId === 'start_node') {
        return
      }

      setPendingDeleteNodeId(nodeId)
    },
    [],
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
      setEdges((prev) =>
        addEdge(
          {
            ...WORKFLOW_EDGE_DEFAULTS,
            ...connection,
          },
          prev,
        ),
      )
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

  const handleDeleteDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setPendingDeleteNodeId(null)
    }
  }, [])

  const handleConfirmDeleteNode = useCallback(() => {
    if (!pendingDeleteNodeId) {
      return
    }

    performDeleteNode(pendingDeleteNodeId)
    setPendingDeleteNodeId(null)
  }, [pendingDeleteNodeId, performDeleteNode])

  const handleBlockLibraryOpenChange = useCallback((nextOpen: boolean) => {
    setBlockLibraryOpen(nextOpen)
    if (!nextOpen) {
      setBlockLibraryContext(null)
    }
  }, [])

  const editorContextValue = useMemo<WorkflowEditorContextValue>(
    () => ({
      insertActivity,
      setQuickAddMenuOpen,
      openBlockLibrary,
      duplicateNode,
      deleteNode,
      focusNode,
    }),
    [
      deleteNode,
      duplicateNode,
      focusNode,
      insertActivity,
      openBlockLibrary,
      setQuickAddMenuOpen,
    ],
  )

  const hasStoredViewport = Boolean(getStoredViewport(workflow?._id || ''))
  const isEmptyCanvas =
    nodes.length === 1 && nodes[0]?.id === 'start_node' && edges.length === 0
  const pendingDeleteNode =
    pendingDeleteNodeId == null
      ? null
      : nodes.find((node) => node.id === pendingDeleteNodeId) ?? null

  useEffect(() => {
    if (!selectedNode || blockLibraryOpen || pendingDeleteNodeId) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isEditableTarget(event.target) ||
        selectedNode.id === 'start_node' ||
        (event.key !== 'Delete' && event.key !== 'Backspace')
      ) {
        return
      }

      event.preventDefault()
      setPendingDeleteNodeId(selectedNode.id)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [blockLibraryOpen, pendingDeleteNodeId, selectedNode])

  return (
    <div className="bg-shell text-ink flex h-full w-full flex-col overflow-hidden p-2 font-sans text-xs md:p-3">
      <div className="border-line-soft bg-panel/95 flex-none rounded-2xl border shadow-xs backdrop-blur-xs">
        <div className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between md:gap-3 md:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={saving}
              className="border-line-soft bg-field-alt hover:bg-panel-hover h-8 rounded-lg px-3 text-xs text-copy shadow-none"
            >
              <ArrowLeft className="mr-2 h-3.5 w-3.5" />
              Back to Workflows
            </Button>
            <h1 className="page-title-gradient min-w-0 truncate text-lg font-semibold md:text-xl">
              {workflow?.name || 'Workflow'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenDisconnectedLibrary}
              disabled={saving}
              className="border-line-soft bg-field-alt hover:bg-panel-hover h-8 rounded-lg px-3 text-xs text-copy shadow-none"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Block
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              className="border-line-soft bg-field-alt hover:bg-panel-hover h-8 rounded-lg px-3 text-xs text-copy shadow-none"
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="brand-button h-8 rounded-lg px-3 text-xs"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save Flow'}
            </Button>
          </div>
        </div>
      </div>

      <WorkflowEditorProvider value={editorContextValue}>
        <div className="flex min-h-0 flex-1 gap-2 pt-2 md:gap-3 md:pt-3">
          <div className="border-line-soft bg-panel/40 relative min-h-0 flex-1 overflow-hidden rounded-2xl border shadow-xs">
            <div
              ref={canvasRef}
              className="bg-shell absolute inset-0 overflow-hidden"
            >
              {isEmptyCanvas ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
                  <div className="bg-panel/92 border-line-soft max-w-sm rounded-2xl border p-5 text-center shadow-xl backdrop-blur-sm">
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
                edgeTypes={edgeTypes}
                fitView={!hasStoredViewport}
                deleteKeyCode={null}
                className="bg-transparent"
                selectNodesOnDrag={false}
                defaultEdgeOptions={WORKFLOW_EDGE_DEFAULTS}
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
            suppressed={quickAddMenuOpen}
          />
        </div>

        <BlockLibraryDialog
          open={blockLibraryOpen}
          insertionContext={blockLibraryContext}
          onOpenChange={handleBlockLibraryOpenChange}
        />

        <AlertDialog
          open={pendingDeleteNode != null}
          onOpenChange={handleDeleteDialogOpenChange}
        >
          <AlertDialogContent className="bg-panel border-line border shadow-xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-ink">
                Delete node?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-muted-copy">
                {pendingDeleteNode
                  ? `Remove "${String(pendingDeleteNode.data?.label ?? pendingDeleteNode.id)}" from this workflow?`
                  : 'Remove this node from the workflow?'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleConfirmDeleteNode}
              >
                Delete node
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </WorkflowEditorProvider>
    </div>
  )
}
