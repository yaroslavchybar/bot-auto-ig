import type { Edge, Node, Viewport, XYPosition } from 'reactflow'
import {
  getActivityById,
  getDefaultConfig,
  normalizeActivityConfig,
  type ActivityOutput,
} from '@/features/automations/activities'
import { normalizeStartConfig } from '../startNode'

export interface BlockInsertionContext {
  sourceNodeId?: string | null
  sourceHandle?: string | null
  disconnected?: boolean
}

const CONNECTED_NODE_X_OFFSET = 330
const CONNECTED_NODE_Y_OFFSET = 78
const DUPLICATE_NODE_X_OFFSET = 32
const DUPLICATE_NODE_Y_OFFSET = 170
const DISCONNECTED_NODE_OFFSET = 24

// Card footprint used to detect overlapping nodes saved with old spacing.
const NODE_WIDTH = 248
const NODE_HEADER_HEIGHT = 64
const NODE_OUTPUT_ROW_HEIGHT = 36
const OVERLAP_GAP = 8
const LAYOUT_X_STEP = 330
const LAYOUT_Y_STEP = 210
const LAYOUT_ORIGIN = { x: 60, y: 60 }

function getNodeHeight(node: Node): number {
  const outputs = getActivityOutputs(node)
  const rows = Math.max(outputs.length, 1)
  return NODE_HEADER_HEIGHT + rows * NODE_OUTPUT_ROW_HEIGHT
}

function nodesIntersect(a: Node, b: Node): boolean {
  return (
    a.position.x - OVERLAP_GAP < b.position.x + NODE_WIDTH &&
    b.position.x - OVERLAP_GAP < a.position.x + NODE_WIDTH &&
    a.position.y - OVERLAP_GAP < b.position.y + getNodeHeight(b) &&
    b.position.y - OVERLAP_GAP < a.position.y + getNodeHeight(a)
  )
}

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

export function normalizeAutomationNode(node: Node): Node {
  if (node.type === 'start') {
    return {
      ...node,
      data: {
        ...node.data,
        config: normalizeStartConfig(
          node.data && typeof node.data.config === 'object'
            ? (node.data.config as Record<string, unknown>)
            : {},
        ),
      },
    }
  }

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

export function duplicateAutomationNode(node: Node): Node {
  return {
    ...cloneData(node),
    id: `${node.id}_copy_${Date.now().toString(36)}`,
    position: {
      x: node.position.x + DUPLICATE_NODE_X_OFFSET,
      y: node.position.y + DUPLICATE_NODE_Y_OFFSET,
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

/** Lay nodes out left-to-right following edges. Used once when saved positions overlap. */
function layoutNodesByDepth(nodes: Node[], edges: Edge[]): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string, string[]>()
  for (const edge of edges) {
    if (byId.has(edge.source) && byId.has(edge.target)) {
      const list = children.get(edge.source) ?? []
      list.push(edge.target)
      children.set(edge.source, list)
    }
  }
  const start = byId.get('start_node') ?? nodes[0]
  if (!start) return nodes

  const depth = new Map<string, number>([[start.id, 0]])
  const queue = [start.id]
  while (queue.length > 0) {
    const id = queue.shift() as string
    const d = depth.get(id) as number
    for (const child of children.get(id) ?? []) {
      if (!depth.has(child)) {
        depth.set(child, d + 1)
        queue.push(child)
      }
    }
  }
  let nextDepth = depth.size > 0 ? Math.max(...depth.values()) + 1 : 0
  for (const node of nodes) {
    if (!depth.has(node.id)) {
      depth.set(node.id, nextDepth)
      nextDepth += 1
    }
  }

  const rowInLevel = new Map<number, number>()
  return nodes.map((node) => {
    const d = depth.get(node.id) ?? 0
    const row = rowInLevel.get(d) ?? 0
    rowInLevel.set(d, row + 1)
    return {
      ...node,
      position: {
        x: LAYOUT_ORIGIN.x + d * LAYOUT_X_STEP,
        y: LAYOUT_ORIGIN.y + row * LAYOUT_Y_STEP,
      },
    }
  })
}

/**
 * Old automations were saved with spacing for narrow cards, so they overlap
 * now. If any two nodes overlap, re-lay the whole canvas out. Otherwise
 * keep the user's manual positions untouched.
 */
export function fixOverlappingNodes(nodes: Node[], edges: Edge[]): Node[] {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodesIntersect(nodes[i], nodes[j])) {
        return layoutNodesByDepth(nodes, edges)
      }
    }
  }
  return nodes
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
