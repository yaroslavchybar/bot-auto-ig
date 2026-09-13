import { useCallback, useEffect } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { ArrowLeft, Plus, Save, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Workflow } from '../types'
import { ActivityNode } from './ActivityNode'
import { BlockLibraryDialog } from './BlockLibraryDialog'
import { NodeSettingsPanel } from './NodeSettingsPanel'
import { StartNode } from './StartNode'
import { WorkflowEdge, WORKFLOW_EDGE_DEFAULTS } from './WorkflowEdge'
import { WorkflowEditorProvider } from './WorkflowEditorContext'
import { useFlowEditorState, isEditableTarget } from '../hooks/useFlowEditorState'

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
  const state = useFlowEditorState(workflow)

  const handleSave = useCallback(() => {
    onSave(state.nodes, state.edges)
  }, [state.edges, state.nodes, onSave])

  // Delete key removes node instantly (undo via toast). Ctrl/Cmd+S saves.
  useEffect(() => {
    if (state.blockLibraryOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const savePressed =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's'
      if (savePressed) {
        event.preventDefault()
        if (!saving) handleSave()
        return
      }
      if (!state.selectedNode || isEditableTarget(event.target)) return
      if (state.selectedNode.id === 'start_node') return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      event.preventDefault()
      state.editorContextValue.deleteNode(state.selectedNode.id)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.blockLibraryOpen, state.selectedNode, state.editorContextValue, handleSave, saving])

  return (
    <div className="bg-shell text-ink flex h-full w-full flex-col overflow-hidden p-2 font-sans text-xs md:p-3">
      <EditorToolbar
        workflowName={workflow?.name}
        saving={saving}
        onClose={onClose}
        onAddBlock={state.handleOpenDisconnectedLibrary}
        onClear={state.handleClear}
        onSave={handleSave}
      />

      <WorkflowEditorProvider value={state.editorContextValue}>
        <div className="flex min-h-0 flex-1 gap-2 pt-2 md:gap-3 md:pt-3">
          <EditorCanvas
            canvasRef={state.canvasRef}
            nodes={state.nodes}
            edges={state.edges}
            isEmptyCanvas={state.isEmptyCanvas}
            hasStoredViewport={state.hasStoredViewport}
            onNodesChange={state.onNodesChange}
            onEdgesChange={state.onEdgesChange}
            onConnect={state.onConnect}
            onSelectionChange={state.onSelectionChange}
            onMoveEnd={state.onMoveEnd}
            onAddBlock={state.handleOpenDisconnectedLibrary}
          />

          <NodeSettingsPanel
            selectedNode={state.selectedNode}
            onUpdateNode={state.handleUpdateNode}
            onClose={state.handleCloseSettings}
            suppressed={state.quickAddMenuOpen}
          />
        </div>

        <BlockLibraryDialog
          open={state.blockLibraryOpen}
          insertionContext={state.blockLibraryContext}
          onOpenChange={state.handleBlockLibraryOpenChange}
        />
      </WorkflowEditorProvider>
    </div>
  )
}

/* ── Toolbar ── */

function EditorToolbar({
  workflowName,
  saving,
  onClose,
  onAddBlock,
  onClear,
  onSave,
}: {
  workflowName?: string
  saving?: boolean
  onClose: () => void
  onAddBlock: () => void
  onClear: () => void
  onSave: () => void
}) {
  return (
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
            Back
          </Button>
          <h1 className="page-title-gradient min-w-0 truncate text-lg font-semibold md:text-xl">
            {workflowName || 'Workflow'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onAddBlock}
            disabled={saving}
            className="border-line-soft bg-field-alt hover:bg-panel-hover h-8 rounded-lg px-3 text-xs text-copy shadow-none"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Block
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-8 rounded-lg px-3 text-xs"
          >
            Clear
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving}
            className="brand-button h-8 rounded-lg px-3 text-xs"
            title="Save (Ctrl+S)"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Flow'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Canvas ── */

import type { MutableRefObject } from 'react'
import type { OnNodesChange, OnEdgesChange, OnConnect, OnSelectionChangeFunc } from 'reactflow'

function EditorCanvas({
  canvasRef,
  nodes,
  edges,
  isEmptyCanvas,
  hasStoredViewport,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectionChange,
  onMoveEnd,
  onAddBlock,
}: {
  canvasRef: MutableRefObject<HTMLDivElement | null>
  nodes: Node[]
  edges: Edge[]
  isEmptyCanvas: boolean
  hasStoredViewport: boolean
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  onSelectionChange: OnSelectionChangeFunc
  onMoveEnd: () => void
  onAddBlock: () => void
}) {
  return (
    <div className="border-line-soft bg-panel/40 relative min-h-0 flex-1 overflow-hidden rounded-2xl border shadow-xs">
      <div
        ref={canvasRef}
        className="bg-shell absolute inset-0 overflow-hidden"
      >
        {isEmptyCanvas ? <EmptyCanvasOverlay onAddBlock={onAddBlock} /> : null}

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
          snapToGrid
          snapGrid={[16, 16]}
          minZoom={0.4}
          maxZoom={1.75}
          defaultEdgeOptions={WORKFLOW_EDGE_DEFAULTS}
        >
          <Controls className="bg-panel-muted border-line" showInteractive={false} />
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.5}
            color="var(--workflow-grid)"
          />
        </ReactFlow>
      </div>
    </div>
  )
}

function EmptyCanvasOverlay({ onAddBlock }: { onAddBlock: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="bg-panel/95 border-line-soft max-w-sm rounded-2xl border p-5 text-center shadow-xl backdrop-blur-sm">
        <div className="bg-panel-subtle mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl">
          <Sparkles className="text-ink h-5 w-5" />
        </div>
        <h3 className="text-ink text-sm font-semibold">
          Start building
        </h3>
        <Button size="sm" className="brand-button mt-4 h-8 rounded-lg px-4 text-xs" onClick={onAddBlock}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add first block
        </Button>
      </div>
    </div>
  )
}
