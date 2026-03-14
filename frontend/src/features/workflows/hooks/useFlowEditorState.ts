import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
  type Viewport,
} from 'reactflow'
import { toast } from 'sonner'
import type { Workflow } from '../types'
import { DEFAULT_START_DATA } from '../components/StartNode'
import { WORKFLOW_EDGE_DEFAULTS } from '../components/WorkflowEdge'
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
} from '../components/workflowEditorUtils'
import { rememberRecentActivity } from '../utils/recentActivities'
import type { WorkflowEditorContextValue } from '../components/WorkflowEditorContext'

const VIEWPORT_STORAGE_KEY = 'workflow-editor-viewport'
const DELETE_UNDO_DURATION_MS = 5000

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

/* ── Node insertion logic ── */

function useNodeInsertion(
  nodes: Node[],
  setNodes: ReturnType<typeof useNodesState>[1],
  setEdges: ReturnType<typeof useEdgesState>[1],
  setSelectedNode: (node: Node | null) => void,
  canvasRef: React.RefObject<HTMLDivElement | null>,
  getViewport: () => Viewport,
) {
  const insertActivity = useCallback(
    (activityId: string, insertionContext: BlockInsertionContext) => {
      const sourceNode = insertionContext.sourceNodeId != null
        ? nodes.find((n) => n.id === insertionContext.sourceNodeId) ?? null
        : null

      const nextPosition = insertionContext.disconnected || !sourceNode
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
    },
    [canvasRef, getViewport, nodes, setEdges, setNodes, setSelectedNode],
  )

  return insertActivity
}

/* ── Delete/restore node logic ── */

function useNodeDeletion(
  nodesRef: React.RefObject<Node[]>,
  edgesRef: React.RefObject<Edge[]>,
  setNodes: ReturnType<typeof useNodesState>[1],
  setEdges: ReturnType<typeof useEdgesState>[1],
  setSelectedNode: (node: Node | null) => void,
) {
  const deleteToastIdRef = useRef<string | number | null>(null)

  const restoreDeletedNode = useCallback(
    (deletedNode: Node, deletedEdges: Edge[]) => {
      const currentNodes = nodesRef.current
      if (currentNodes.some((n) => n.id === deletedNode.id)) return
      const restoredNode = { ...deletedNode, selected: true }
      const restoredNodes = selectOnlyNode([...currentNodes, restoredNode], deletedNode.id)
      const restoredNodeIds = new Set(restoredNodes.map((n) => n.id))
      const currentEdges = edgesRef.current
      const currentEdgeIds = new Set(currentEdges.map((e) => e.id))
      const restoredEdges = deletedEdges.filter(
        (e) =>
          !currentEdgeIds.has(e.id) &&
          restoredNodeIds.has(e.source) &&
          restoredNodeIds.has(e.target),
      )
      setNodes(restoredNodes)
      setEdges([...currentEdges, ...restoredEdges])
      setSelectedNode(restoredNode)
    },
    [edgesRef, nodesRef, setEdges, setNodes, setSelectedNode],
  )

  const performDeleteNode = useCallback(
    (nodeId: string) => {
      if (nodeId === 'start_node') return
      const currentNodes = nodesRef.current
      const currentEdges = edgesRef.current
      const nodeToDelete = currentNodes.find((n) => n.id === nodeId)
      if (!nodeToDelete) return
      const deletedEdges = currentEdges.filter(
        (e) => e.source === nodeId || e.target === nodeId,
      )
      if (deleteToastIdRef.current != null) toast.dismiss(deleteToastIdRef.current)
      setNodes(currentNodes.filter((n) => n.id !== nodeId))
      setEdges(removeNodeEdges(currentEdges, nodeId))
      setSelectedNode((prev) => (prev?.id === nodeId ? null : prev) as Node | null)
      deleteToastIdRef.current = toast('Node deleted', {
        description: 'You can undo this deletion for the next 5 seconds.',
        duration: DELETE_UNDO_DURATION_MS,
        position: 'bottom-left',
        action: {
          label: 'Undo',
          onClick: () => restoreDeletedNode(nodeToDelete, deletedEdges),
        },
        onDismiss: () => { deleteToastIdRef.current = null },
        onAutoClose: () => { deleteToastIdRef.current = null },
      })
    },
    [edgesRef, nodesRef, restoreDeletedNode, setEdges, setNodes, setSelectedNode],
  )

  return performDeleteNode
}

/* ── Block library state ── */

function useBlockLibraryState() {
  const [blockLibraryOpen, setBlockLibraryOpen] = useState(false)
  const [blockLibraryContext, setBlockLibraryContext] =
    useState<BlockInsertionContext | null>(null)

  const openBlockLibrary = useCallback((ctx: BlockInsertionContext) => {
    setBlockLibraryContext(ctx)
    setBlockLibraryOpen(true)
  }, [])

  const handleOpenDisconnectedLibrary = useCallback(() => {
    setBlockLibraryContext({ disconnected: true })
    setBlockLibraryOpen(true)
  }, [])

  const handleBlockLibraryOpenChange = useCallback((nextOpen: boolean) => {
    setBlockLibraryOpen(nextOpen)
    if (!nextOpen) setBlockLibraryContext(null)
  }, [])

  return {
    blockLibraryOpen, blockLibraryContext,
    openBlockLibrary, handleOpenDisconnectedLibrary,
    handleBlockLibraryOpenChange,
    setBlockLibraryOpen, setBlockLibraryContext,
  }
}

/* ── Initial data from workflow ── */

function useInitialGraphData(workflow: Workflow | null) {
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
      style: { ...WORKFLOW_EDGE_DEFAULTS.style, ...edge.style },
      markerEnd: edge.markerEnd ?? WORKFLOW_EDGE_DEFAULTS.markerEnd,
      type: 'workflow',
    }))
  }, [workflow])

  return { initialNodes, initialEdges }
}

/* ── Viewport persistence ── */

function useViewportPersistence(
  workflow: Workflow | null,
  setViewport: (viewport: Viewport, opts?: { duration: number }) => void,
  getViewport: () => Viewport,
) {
  const viewportRestored = useRef(false)

  useEffect(() => {
    if (workflow?._id && !viewportRestored.current) {
      const stored = getStoredViewport(workflow._id)
      if (stored) window.setTimeout(() => setViewport(stored, { duration: 0 }), 50)
      viewportRestored.current = true
    }
  }, [setViewport, workflow?._id])

  const onMoveEnd = useCallback(() => {
    if (workflow?._id) saveViewport(workflow._id, getViewport())
  }, [getViewport, workflow])

  const hasStoredViewport = Boolean(getStoredViewport(workflow?._id || ''))

  return { onMoveEnd, hasStoredViewport }
}

/* ── Node action callbacks ── */

function useNodeActions(
  nodes: Node[],
  setNodes: ReturnType<typeof useNodesState>[1],
  setSelectedNode: React.Dispatch<React.SetStateAction<Node | null>>,
) {
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      setSelectedNode(selectedNodes.length === 1 ? selectedNodes[0] : null)
    },
    [setSelectedNode],
  )

  const focusNode = useCallback(
    (nodeId: string) => {
      const matchedNode = nodes.find((n) => n.id === nodeId) ?? null
      setNodes((prev) => selectOnlyNode(prev, nodeId))
      setSelectedNode(matchedNode ? { ...matchedNode, selected: true } : null)
    },
    [nodes, setNodes, setSelectedNode],
  )

  const handleUpdateNode = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, data: newData } : n)),
      )
      setSelectedNode((prev) =>
        prev?.id === nodeId ? { ...prev, data: newData } : prev,
      )
    },
    [setNodes, setSelectedNode],
  )

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const sourceNode = nodes.find((n) => n.id === nodeId)
      if (!sourceNode || sourceNode.id === 'start_node') return
      const clonedNode = duplicateWorkflowNode(sourceNode)
      setNodes((prev) => selectOnlyNode([...prev, clonedNode], clonedNode.id))
      setSelectedNode({ ...clonedNode, selected: true })
    },
    [nodes, setNodes, setSelectedNode],
  )

  const handleCloseSettings = useCallback(() => {
    setNodes((prev) => selectOnlyNode(prev, null))
    setSelectedNode(null)
  }, [setNodes, setSelectedNode])

  return { onSelectionChange, focusNode, handleUpdateNode, duplicateNode, handleCloseSettings }
}

/* ── Main hook ── */

/* ── Graph mutation operations ── */

function useGraphOperations(
  setNodes: ReturnType<typeof useNodesState>[1],
  setEdges: ReturnType<typeof useEdgesState>[1],
  setSelectedNode: (n: Node | null) => void,
  nodesRef: { current: Node[] },
  edgesRef: { current: Edge[] },
  blockLibrary: ReturnType<typeof useBlockLibraryState>,
) {
  const performDeleteNode = useNodeDeletion(nodesRef, edgesRef, setNodes, setEdges, setSelectedNode)
  const [pendingDeleteNodeId, setPendingDeleteNodeId] = useState<string | null>(null)

  const deleteNode = useCallback((nodeId: string) => {
    if (nodeId === 'start_node') return
    setPendingDeleteNodeId(nodeId)
  }, [])

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((prev) => addEdge({ ...WORKFLOW_EDGE_DEFAULTS, ...connection }, prev))
    },
    [setEdges],
  )

  const handleClear = useCallback(() => {
    setNodes([createDefaultStartNode()])
    setEdges([])
    setSelectedNode(null)
    blockLibrary.setBlockLibraryOpen(false)
    blockLibrary.setBlockLibraryContext(null)
  }, [blockLibrary, setEdges, setNodes, setSelectedNode])

  const handleDeleteDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setPendingDeleteNodeId(null)
  }, [])

  const handleConfirmDeleteNode = useCallback(() => {
    if (!pendingDeleteNodeId) return
    performDeleteNode(pendingDeleteNodeId)
    setPendingDeleteNodeId(null)
  }, [pendingDeleteNodeId, performDeleteNode])

  return {
    pendingDeleteNodeId, setPendingDeleteNodeId, deleteNode,
    onConnect, handleClear, handleDeleteDialogOpenChange, handleConfirmDeleteNode,
  }
}

/* ── Main hook ── */

export function useFlowEditorState(workflow: Workflow | null) {
  const { getViewport, setViewport } = useReactFlow()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef<Node[]>([])
  const edgesRef = useRef<Edge[]>([])

  const { initialNodes, initialEdges } = useInitialGraphData(workflow)
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [quickAddMenuOpen, setQuickAddMenuOpen] = useState(false)

  const blockLibrary = useBlockLibraryState()

  useEffect(() => { nodesRef.current = nodes; edgesRef.current = edges }, [edges, nodes])

  const { onMoveEnd, hasStoredViewport } = useViewportPersistence(workflow, setViewport, getViewport)
  const { onSelectionChange, focusNode, handleUpdateNode, duplicateNode, handleCloseSettings } =
    useNodeActions(nodes, setNodes, setSelectedNode)

  const insertActivity = useNodeInsertion(nodes, setNodes, setEdges, setSelectedNode, canvasRef, getViewport)

  const insertActivityWithClose = useCallback(
    (activityId: string, insertionContext: BlockInsertionContext) => {
      insertActivity(activityId, insertionContext)
      blockLibrary.setBlockLibraryOpen(false)
      blockLibrary.setBlockLibraryContext(null)
    },
    [blockLibrary, insertActivity],
  )

  const graphOps = useGraphOperations(setNodes, setEdges, setSelectedNode, nodesRef, edgesRef, blockLibrary)

  const editorContextValue = useMemo<WorkflowEditorContextValue>(
    () => ({
      insertActivity: insertActivityWithClose,
      setQuickAddMenuOpen,
      openBlockLibrary: blockLibrary.openBlockLibrary,
      duplicateNode, deleteNode: graphOps.deleteNode, focusNode,
    }),
    [graphOps.deleteNode, duplicateNode, focusNode, insertActivityWithClose, blockLibrary.openBlockLibrary, setQuickAddMenuOpen],
  )

  const isEmptyCanvas = nodes.length === 1 && nodes[0]?.id === 'start_node' && edges.length === 0
  const pendingDeleteNode = graphOps.pendingDeleteNodeId == null
    ? null
    : nodes.find((n) => n.id === graphOps.pendingDeleteNodeId) ?? null

  return {
    canvasRef, nodes, edges, selectedNode,
    blockLibraryOpen: blockLibrary.blockLibraryOpen,
    blockLibraryContext: blockLibrary.blockLibraryContext,
    quickAddMenuOpen, pendingDeleteNodeId: graphOps.pendingDeleteNodeId, pendingDeleteNode,
    hasStoredViewport, isEmptyCanvas, editorContextValue,
    onNodesChange, onEdgesChange, onConnect: graphOps.onConnect, onSelectionChange, onMoveEnd,
    handleUpdateNode, handleClear: graphOps.handleClear,
    handleOpenDisconnectedLibrary: blockLibrary.handleOpenDisconnectedLibrary,
    handleCloseSettings, handleDeleteDialogOpenChange: graphOps.handleDeleteDialogOpenChange,
    handleConfirmDeleteNode: graphOps.handleConfirmDeleteNode,
    handleBlockLibraryOpenChange: blockLibrary.handleBlockLibraryOpenChange,
    setPendingDeleteNodeId: graphOps.setPendingDeleteNodeId,
  }
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}
