import { ACTIVITY_IDS, type ActivityId } from '../shared/contracts.js'
export type AutomationNode = {
  id: string
  type?: string
  data?: {
    activityId?: string
    config?: Record<string, any>
  }
}
export type AutomationEdge = {
  source: string
  target: string
  sourceHandle?: string | null
}

export function nodeActivity(node: AutomationNode): ActivityId | 'start' {
  const id = node.type === 'start' ? 'start' : node.data?.activityId
  if (id === 'start' || ACTIVITY_IDS.includes(id as ActivityId)) return id as ActivityId | 'start'
  throw new Error(`Unsupported automation activity: ${id ?? node.type}`)
}

export function nextNode(
  nodes: AutomationNode[],
  edges: AutomationEdge[],
  current: AutomationNode,
  handle: string,
): AutomationNode | undefined {
  const outgoing = edges.filter((edge) => edge.source === current.id)
  const edge =
    outgoing.find((edge) => edge.sourceHandle === handle) ||
    outgoing.find((edge) => !edge.sourceHandle)
  if (!edge) return undefined
  const node = nodes.find((node) => node.id === edge.target)
  if (!node)
    throw new Error(`Automation edge points to missing node: ${edge.target}`)
  return node
}

export function advanceLoop(
  state: { runs?: number },
  iterations: number,
): 'loop' | 'done' {
  const count = Math.max(1, Math.floor(iterations))
  if ((state.runs || 0) >= count) {
    state.runs = 0
    return 'done'
  }
  state.runs = (state.runs || 0) + 1
  return 'loop'
}

export function selectedLists(nodes: AutomationNode[]): string[] {
  const lists = nodes
    .filter((node) => node.type === 'start' || nodeActivity(node) === 'start')
    .flatMap((node) => node.data?.config?.sourceLists || [])
  return lists
}

export function startConfig(nodes: AutomationNode[]): Record<string, any> {
  return (
    nodes.find((node) => node.type === 'start' || nodeActivity(node) === 'start')
      ?.data?.config || {}
  )
}

export function profileEligible(
  profile: {
    using: boolean
    status?: string | null
    login: boolean
    listIds?: string[] | null
    lastOpenedAt?: number | null
  },
  lists: string[],
  cooldownMinutes = 0,
): boolean {
  if (profile.using || profile.status === 'running' || !profile.login)
    return false
  if (lists.length && !profile.listIds?.some((id) => lists.includes(id)))
    return false
  const lastOpened = profile.lastOpenedAt
    ? profile.lastOpenedAt
    : NaN
  return !(
    cooldownMinutes > 0 && lastOpened > Date.now() - cooldownMinutes * 60_000
  )
}
