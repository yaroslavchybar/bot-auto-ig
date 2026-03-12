import type { Edge, Node, Viewport, XYPosition } from 'reactflow'
import {
  getActivityById,
  getDefaultConfig,
  normalizeActivityConfig,
  type ActivityOutput,
} from '@/features/workflows/activities'

export interface BlockInsertionContext {
  sourceNodeId?: string | null
  sourceHandle?: string | null
  disconnected?: boolean
}

const CONNECTED_NODE_X_OFFSET = 260
const CONNECTED_NODE_Y_OFFSET = 78
const DUPLICATE_NODE_OFFSET = 40
const DISCONNECTED_NODE_OFFSET = 24

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getActivityOutputs(node: Node): ActivityOutput[] {
  if (node.type !== 'activity') {
    return []
  }

  const activityId =
    node.data && typeof node.data.activityId === 'string'
      ? node.data.activityId
      : ''
  const activity = getActivityById(activityId)
  return activity?.outputs ?? []
}

export function createActivityNode(
  activityId: string,
  position: XYPosition,
): Node {
  const activity = getActivityById(activityId)

  return {
    id: `${activityId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'activity',
    position,
    data: {
      activityId,
      label: activity?.name ?? activityId,
      config: normalizeActivityConfig(activityId, getDefaultConfig(activityId)),
    },
  }
}

export function normalizeWorkflowNode(node: Node): Node {
  if (node.type !== 'activity') {
    return node
  }

  const activityId =
    node.data && typeof node.data.activityId === 'string'
      ? node.data.activityId
      : ''

  return {
    ...node,
    data: {
      ...node.data,
      config: normalizeActivityConfig(
        activityId,
        node.data && typeof node.data.config === 'object'
          ? (node.data.config as Record<string, unknown>)
          : {},
      ),
    },
  }
}

export function createEdgeId(
  sourceNodeId: string,
  targetNodeId: string,
  sourceHandle?: string | null,
): string {
  return `${sourceNodeId}:${sourceHandle || 'default'}:${targetNodeId}`
}

export function duplicateWorkflowNode(node: Node): Node {
  return {
    ...cloneData(node),
    id: `${node.id}_copy_${Date.now().toString(36)}`,
    position: {
      x: node.position.x + DUPLICATE_NODE_OFFSET,
      y: node.position.y + DUPLICATE_NODE_OFFSET,
    },
    selected: false,
  }
}

export function removeNodeEdges(edges: Edge[], nodeId: string): Edge[] {
  return edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
}

export function selectOnlyNode(nodes: Node[], nodeId: string | null): Node[] {
  return nodes.map((node) => ({
    ...node,
    selected: nodeId !== null && node.id === nodeId,
  }))
}

export function getSingleOutputHandle(node: Node): string | null {
  if (node.type === 'start') {
    return null
  }

  const outputs = getActivityOutputs(node)
  if (outputs.length !== 1) {
    return null
  }

  return outputs[0] === 'next' || outputs[0] === 'success' ? null : outputs[0]
}

export function getConnectedInsertPosition(
  sourceNode: Node,
  sourceHandle?: string | null,
): XYPosition {
  const outputs = getActivityOutputs(sourceNode)
  const outputIndex =
    sourceHandle && outputs.length > 1
      ? Math.max(outputs.indexOf(sourceHandle as ActivityOutput), 0)
      : 0

  return {
    x: sourceNode.position.x + CONNECTED_NODE_X_OFFSET,
    y: sourceNode.position.y + outputIndex * CONNECTED_NODE_Y_OFFSET,
  }
}

export function getDisconnectedInsertPosition(args: {
  viewport: Viewport
  canvasWidth: number
  canvasHeight: number
  existingNodes: Node[]
}): XYPosition {
  const { viewport, canvasWidth, canvasHeight, existingNodes } = args
  const centerX = (canvasWidth / 2 - viewport.x) / viewport.zoom
  const centerY = (canvasHeight / 2 - viewport.y) / viewport.zoom
  const staggerOffset = existingNodes.length * DISCONNECTED_NODE_OFFSET

  return {
    x: centerX - 90 + staggerOffset,
    y: centerY - 40 + staggerOffset,
  }
}
