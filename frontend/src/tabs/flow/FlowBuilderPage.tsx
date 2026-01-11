import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from 'reactflow'
import 'reactflow/dist/style.css'

const initialNodes: Node[] = [
  {
    id: 'runtime',
    position: { x: 80, y: 80 },
    data: { label: 'Runtime Settings' },
    type: 'default',
  },
  {
    id: 'activity',
    position: { x: 420, y: 80 },
    data: { label: 'Activity Settings' },
    type: 'default',
  },
  {
    id: 'controls',
    position: { x: 250, y: 220 },
    data: { label: 'Automation Controls' },
    type: 'default',
  },
]

const initialEdges: Edge[] = [
  { id: 'runtime->controls', source: 'runtime', target: 'controls' },
  { id: 'activity->controls', source: 'activity', target: 'controls' },
]

export function FlowBuilderPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((prev) => addEdge(connection, prev))
    },
    [setEdges]
  )

  const reset = useCallback(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [setEdges, setNodes])

  return (
    <div className="p-2 h-full flex flex-col space-y-3 overflow-hidden">
      <div className="flex items-center justify-between flex-none">
        <div>
          <h1 className="text-2xl font-bold">Flow Builder (Test)</h1>
          <p className="text-sm text-muted-foreground">React Flow sandbox for Instagram settings nodes</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reset}>Reset</Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
    </div>
  )
}
