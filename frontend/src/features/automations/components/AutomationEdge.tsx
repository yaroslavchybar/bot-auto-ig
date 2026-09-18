import { useState } from 'react'
import {
  EdgeLabelRenderer,
  MarkerType,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from 'reactflow'
import { X } from 'lucide-react'

const DEFAULT_EDGE_COLOR = 'var(--automation-edge)'

export function AutomationEdge({
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

  const active = hovered || selected
  const stroke =
    typeof style?.stroke === 'string' ? style.stroke : DEFAULT_EDGE_COLOR

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke={stroke}
        strokeWidth={active ? 2.5 : 2}
        strokeLinecap="round"
        markerEnd={markerEnd}
        style={{ opacity: active ? 1 : 0.7 }}
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={28}
        className="cursor-pointer"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {active && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Delete connection"
            className="absolute flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel)] text-[var(--subtle-copy)] shadow-md hover:border-[var(--status-danger-border)] hover:text-[var(--status-danger)]"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={(event) => {
              event.stopPropagation()
              setEdges((edges) => edges.filter((edge) => edge.id !== id))
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const AUTOMATION_EDGE_DEFAULTS = {
  type: 'automation',
  style: {
    strokeWidth: 2,
    stroke: DEFAULT_EDGE_COLOR,
  },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: DEFAULT_EDGE_COLOR,
    width: 18,
    height: 18,
  },
} as const
