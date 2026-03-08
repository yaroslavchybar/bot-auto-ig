export const WORKFLOW_EXPORT_FORMAT = 'bot-auto-ig.workflow'
export const WORKFLOW_EXPORT_VERSION = '1.0'
export const WORKFLOW_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024
export const WORKFLOW_IMPORT_MAX_NODES = 500
export const WORKFLOW_IMPORT_MAX_EDGES = 2000

type JsonRecord = Record<string, unknown>

export interface WorkflowImportEnvelope {
  format: string
  version: string
  exportedAt: string
  workflow: {
    name: string
    description?: string
    nodes: JsonRecord[]
    edges: JsonRecord[]
  }
}

export interface ValidateWorkflowImportInput {
  fileName: string
  fileSizeBytes: number
  rawText: string
  existingWorkflowNames: string[]
  existingListIds: string[]
  resolveActivityById: (activityId: string) => unknown
  now?: Date
}

export interface ValidateWorkflowImportResult {
  workflow: {
    name: string
    description?: string
    nodes: JsonRecord[]
    edges: JsonRecord[]
  }
  warnings: string[]
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeName(name: string) {
  return name.trim().toLowerCase()
}

function toDisplayImportTimestamp(now: Date): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export function getImportedWorkflowName(
  name: string,
  existingNames: string[],
  now = new Date(),
): string {
  const cleaned = name.trim()
  const usedNames = new Set(existingNames.map(normalizeName))
  if (!usedNames.has(normalizeName(cleaned))) {
    return cleaned
  }

  const renamed = `${cleaned} (imported ${toDisplayImportTimestamp(now)})`
  if (!usedNames.has(normalizeName(renamed))) {
    return renamed
  }

  let counter = 2
  while (true) {
    const candidate = `${renamed} ${counter}`
    if (!usedNames.has(normalizeName(candidate))) {
      return candidate
    }
    counter += 1
  }
}

export function buildWorkflowExportEnvelope(workflow: {
  name: string
  description?: string
  nodes: unknown
  edges: unknown
}): WorkflowImportEnvelope {
  return {
    format: WORKFLOW_EXPORT_FORMAT,
    version: WORKFLOW_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    workflow: {
      name: workflow.name,
      description: workflow.description,
      nodes: Array.isArray(workflow.nodes)
        ? (workflow.nodes as JsonRecord[])
        : [],
      edges: Array.isArray(workflow.edges)
        ? (workflow.edges as JsonRecord[])
        : [],
    },
  }
}

export function validateWorkflowImport(
  input: ValidateWorkflowImportInput,
): ValidateWorkflowImportResult {
  const {
    fileName,
    fileSizeBytes,
    rawText,
    existingWorkflowNames,
    existingListIds,
    resolveActivityById,
    now = new Date(),
  } = input

  if (!fileName.toLowerCase().endsWith('.json')) {
    throw new Error('Import accepts only .json files')
  }

  if (fileSizeBytes > WORKFLOW_IMPORT_MAX_FILE_BYTES) {
    throw new Error(
      `File is too large. Maximum size is ${WORKFLOW_IMPORT_MAX_FILE_BYTES} bytes (2MB)`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error('Invalid JSON file')
  }

  if (!isRecord(parsed)) {
    throw new Error('Invalid import envelope')
  }

  if (parsed.format !== WORKFLOW_EXPORT_FORMAT) {
    throw new Error(`Invalid format. Expected "${WORKFLOW_EXPORT_FORMAT}"`)
  }

  if (parsed.version !== WORKFLOW_EXPORT_VERSION) {
    throw new Error(
      `Unsupported version. Expected "${WORKFLOW_EXPORT_VERSION}"`,
    )
  }

  if (typeof parsed.exportedAt !== 'string' || !parsed.exportedAt.trim()) {
    throw new Error('Invalid import envelope: missing exportedAt')
  }

  const workflowRaw = parsed.workflow
  if (!isRecord(workflowRaw)) {
    throw new Error('Invalid import envelope: missing workflow object')
  }

  const rawName =
    typeof workflowRaw.name === 'string' ? workflowRaw.name.trim() : ''
  if (!rawName) {
    throw new Error('workflow.name is required')
  }

  if (
    workflowRaw.description !== undefined &&
    typeof workflowRaw.description !== 'string'
  ) {
    throw new Error('workflow.description must be a string when provided')
  }

  if (!Array.isArray(workflowRaw.nodes)) {
    throw new Error('workflow.nodes must be an array')
  }

  if (!Array.isArray(workflowRaw.edges)) {
    throw new Error('workflow.edges must be an array')
  }

  const nodes = workflowRaw.nodes as unknown[]
  const edges = workflowRaw.edges as unknown[]

  if (nodes.length > WORKFLOW_IMPORT_MAX_NODES) {
    throw new Error(`workflow.nodes exceeds cap (${WORKFLOW_IMPORT_MAX_NODES})`)
  }

  if (edges.length > WORKFLOW_IMPORT_MAX_EDGES) {
    throw new Error(`workflow.edges exceeds cap (${WORKFLOW_IMPORT_MAX_EDGES})`)
  }

  const nodeIds = new Set<string>()
  const unknownActivityIds = new Set<string>()
  const missingListIds = new Set<string>()
  const availableListIds = new Set(
    existingListIds.map((id) => String(id).trim()).filter(Boolean),
  )
  let hasStartNode = false

  nodes.forEach((node, index) => {
    if (!isRecord(node)) {
      throw new Error(`workflow.nodes[${index}] must be an object`)
    }

    const nodeId = typeof node.id === 'string' ? node.id.trim() : ''
    if (!nodeId) {
      throw new Error(`workflow.nodes[${index}].id must be a non-empty string`)
    }

    if (nodeIds.has(nodeId)) {
      throw new Error(`Duplicate node id "${nodeId}"`)
    }
    nodeIds.add(nodeId)

    const nodeType = typeof node.type === 'string' ? node.type : ''
    if (nodeType === 'start' || nodeId === 'start_node') {
      hasStartNode = true
    }

    const nodeData = isRecord(node.data) ? node.data : null
    const activityId =
      nodeData && typeof nodeData.activityId === 'string'
        ? nodeData.activityId.trim()
        : ''

    if (nodeType === 'activity' && !activityId) {
      throw new Error(
        `workflow.nodes[${index}] is an activity node without data.activityId`,
      )
    }

    if (activityId) {
      if (!resolveActivityById(activityId)) {
        unknownActivityIds.add(activityId)
      }

      if (activityId === 'select_list') {
        const config = isRecord(nodeData?.config) ? nodeData.config : null
        const sourceLists = Array.isArray(config?.sourceLists)
          ? config.sourceLists
          : []

        sourceLists.forEach((listId) => {
          if (typeof listId !== 'string') return
          const cleanedId = listId.trim()
          if (!cleanedId) return
          if (!availableListIds.has(cleanedId)) {
            missingListIds.add(cleanedId)
          }
        })
      }
    }
  })

  if (!hasStartNode) {
    throw new Error(
      'workflow must include at least one start node (type "start" or id "start_node")',
    )
  }

  const missingEdgeEndpoints = new Set<string>()
  edges.forEach((edge, index) => {
    if (!isRecord(edge)) {
      throw new Error(`workflow.edges[${index}] must be an object`)
    }

    const source = typeof edge.source === 'string' ? edge.source.trim() : ''
    const target = typeof edge.target === 'string' ? edge.target.trim() : ''

    if (!source || !target) {
      throw new Error(
        `workflow.edges[${index}] must include non-empty source and target`,
      )
    }

    if (!nodeIds.has(source)) missingEdgeEndpoints.add(source)
    if (!nodeIds.has(target)) missingEdgeEndpoints.add(target)
  })

  if (missingEdgeEndpoints.size > 0) {
    throw new Error(
      `Edge endpoints reference missing node IDs: ${Array.from(missingEdgeEndpoints).sort().join(', ')}`,
    )
  }

  if (unknownActivityIds.size > 0) {
    throw new Error(
      `Unknown activity IDs: ${Array.from(unknownActivityIds).sort().join(', ')}`,
    )
  }

  const workflowName = getImportedWorkflowName(
    rawName,
    existingWorkflowNames,
    now,
  )
  const warnings: string[] = []

  if (workflowName !== rawName) {
    warnings.push(
      `Workflow name already exists. Imported as "${workflowName}".`,
    )
  }

  if (missingListIds.size > 0) {
    warnings.push(
      `Select List node references missing list IDs: ${Array.from(missingListIds).sort().join(', ')}`,
    )
  }

  return {
    workflow: {
      name: workflowName,
      description:
        typeof workflowRaw.description === 'string'
          ? workflowRaw.description
          : undefined,
      nodes: nodes as JsonRecord[],
      edges: edges as JsonRecord[],
    },
    warnings,
  }
}
