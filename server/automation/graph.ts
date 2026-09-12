export type WorkflowNode = {
  id: string
  type?: string
  data?: {
    activityId?: string
    config?: Record<string, any>
    sourceLists?: string[]
  }
}
export type WorkflowEdge = {
  source: string
  target: string
  sourceHandle?: string | null
}

export function nodeActivity(node: WorkflowNode): string {
  return node.data?.activityId || node.type || ''
}

export function nextNode(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  current: WorkflowNode,
  handle: string,
): WorkflowNode | undefined {
  const outgoing = edges.filter((edge) => edge.source === current.id)
  const edge =
    outgoing.find((edge) => edge.sourceHandle === handle) ||
    outgoing.find((edge) => !edge.sourceHandle)
  if (!edge) return undefined
  const node = nodes.find((node) => node.id === edge.target)
  if (!node)
    throw new Error(`Workflow edge points to missing node: ${edge.target}`)
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

export function selectedLists(nodes: WorkflowNode[]): string[] {
  const lists = nodes
    .filter((node) => nodeActivity(node) === 'select_list')
    .flatMap((node) => node.data?.config?.sourceLists || [])
  return lists.length
    ? lists
    : nodes.find((node) => node.type === 'start')?.data?.sourceLists || []
}

export function profileEligible(
  profile: {
    Using: boolean
    status?: string | null
    login: boolean
    list_ids?: string[] | null
    last_opened_at?: string | null
  },
  lists: string[],
  cooldownMinutes = 0,
): boolean {
  if (profile.Using || profile.status === 'running' || !profile.login)
    return false
  if (lists.length && !profile.list_ids?.some((id) => lists.includes(id)))
    return false
  const lastOpened = profile.last_opened_at
    ? Date.parse(profile.last_opened_at)
    : NaN
  return !(
    cooldownMinutes > 0 && lastOpened > Date.now() - cooldownMinutes * 60_000
  )
}
