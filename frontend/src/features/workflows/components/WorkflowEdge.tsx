import { useState } from 'react'
import {
  EdgeLabelRenderer,
  MarkerType,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from 'reactflow'
import { Trash2 } from 'lucide-react'

const DEFAULT_EDGE_COLOR = 'var(--workflow-edge)'

export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  selected,
  style,
}: EdgeProps) {
  const { setEdges } = useReactFlow()
  const [hovered, setHovered] = useState(false)
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const stroke = typeof style?.stroke === 'string' ? style.stroke : DEFAULT_EDGE_COLOR
  const strokeWidth =
    typeof style?.strokeWidth === 'number' ? style.strokeWidth : 1.5

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        markerEnd={markerEnd}
        className="transition-[stroke,stroke-width]"
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        className="cursor-pointer"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {(hovered || selected) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="button-danger absolute flex h-8 w-8 items-center justify-center rounded-full shadow-lg"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={() => {
              setEdges((edges) => edges.filter((edge) => edge.id !== id))
            }}
            aria-label="Delete connection"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const WORKFLOW_EDGE_DEFAULTS = {
  type: 'workflow',
  style: {
    strokeWidth: 1.5,
    stroke: DEFAULT_EDGE_COLOR,
  },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: DEFAULT_EDGE_COLOR,
  },
} as const
