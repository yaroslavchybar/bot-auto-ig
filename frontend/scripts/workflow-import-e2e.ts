import {
  buildWorkflowExportEnvelope,
  WORKFLOW_EXPORT_FORMAT,
  WORKFLOW_EXPORT_VERSION,
  WORKFLOW_IMPORT_MAX_FILE_BYTES,
  WORKFLOW_IMPORT_MAX_NODES,
  validateWorkflowImport,
} from '../src/tabs/workflows/workflowImportExport'

function makeValidEnvelope(activityId = 'start_browser') {
  return {
    format: WORKFLOW_EXPORT_FORMAT,
    version: WORKFLOW_EXPORT_VERSION,
    exportedAt: '2026-03-06T00:00:00.000Z',
    workflow: {
      name: 'Imported Workflow',
      description: 'Imported from file',
      nodes: [
        {
          id: 'start_node',
          type: 'start',
          position: { x: 100, y: 100 },
          data: { label: 'Start' },
        },
        {
          id: 'node_1',
          type: 'activity',
          position: { x: 280, y: 100 },
          data: {
            activityId,
            label: 'Start Browser',
            config: {},
          },
        },
      ],
      edges: [
        {
          id: 'edge_1',
          source: 'start_node',
          target: 'node_1',
        },
      ],
    },
  }
}

const knownActivities = new Set(['start_browser', 'select_list'])
const resolveActivityById = (activityId: string) => knownActivities.has(activityId)

type Scenario = {
  name: string
  run: () => void
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

const scenarios: Scenario[] = [
  {
    name: 'happy-path valid import passes',
    run: () => {
      const payload = makeValidEnvelope()
      const result = validateWorkflowImport({
        fileName: 'workflow.json',
        fileSizeBytes: 1024,
        rawText: JSON.stringify(payload),
        existingWorkflowNames: [],
        existingListIds: [],
        resolveActivityById,
        now: new Date('2026-03-06T10:45:00.000Z'),
      })

      if (result.workflow.name !== 'Imported Workflow') {
        throw new Error(`unexpected workflow name: ${result.workflow.name}`)
      }

      assert(result.warnings.length === 0, 'expected no warnings for valid import')
    },
  },
  {
    name: 'happy-path export envelope keeps only workflow contract fields',
    run: () => {
      const envelope = buildWorkflowExportEnvelope({
        name: 'Exported Workflow',
        description: 'Round-trip candidate',
        nodes: [{ id: 'start_node' }],
        edges: [{ id: 'edge_1' }],
      })

      assert(envelope.format === WORKFLOW_EXPORT_FORMAT, 'unexpected export format')
      assert(envelope.version === WORKFLOW_EXPORT_VERSION, 'unexpected export version')
      assert(typeof envelope.exportedAt === 'string' && envelope.exportedAt.length > 0, 'missing exportedAt')

      const workflowKeys = Object.keys(envelope.workflow).sort().join(',')
      assert(
        workflowKeys === 'description,edges,name,nodes',
        `unexpected workflow keys: ${workflowKeys}`
      )
    },
  },
  {
    name: 'happy-path duplicate names auto-rename with timestamp suffix',
    run: () => {
      const payload = makeValidEnvelope()
      const result = validateWorkflowImport({
        fileName: 'workflow.json',
        fileSizeBytes: 1024,
        rawText: JSON.stringify(payload),
        existingWorkflowNames: ['Imported Workflow'],
        existingListIds: [],
        resolveActivityById,
        now: new Date(2026, 2, 6, 10, 45),
      })

      assert(
        result.workflow.name === 'Imported Workflow (imported 2026-03-06 10:45)',
        `unexpected renamed workflow name: ${result.workflow.name}`
      )
      assert(result.warnings.length === 1, `expected one rename warning, got ${result.warnings.length}`)
    },
  },
  {
    name: 'warning-path missing select_list IDs do not block import',
    run: () => {
      const payload = makeValidEnvelope('select_list')
      payload.workflow.nodes[1] = {
        ...payload.workflow.nodes[1],
        data: {
          activityId: 'select_list',
          label: 'Select List',
          config: {
            sourceLists: ['list-a', 'list-b'],
          },
        },
      }

      const result = validateWorkflowImport({
        fileName: 'workflow.json',
        fileSizeBytes: 1024,
        rawText: JSON.stringify(payload),
        existingWorkflowNames: [],
        existingListIds: ['list-a'],
        resolveActivityById,
      })

      assert(result.workflow.name === 'Imported Workflow', `unexpected workflow name: ${result.workflow.name}`)
      assert(result.warnings.length === 1, `expected one warning, got ${result.warnings.length}`)
      assert(
        result.warnings[0]?.includes('list-b'),
        `expected missing list warning to mention list-b, got ${result.warnings[0]}`
      )
    },
  },
  {
    name: 'negative invalid extension is rejected',
    run: () => {
      const payload = makeValidEnvelope()
      try {
        validateWorkflowImport({
          fileName: 'workflow.txt',
          fileSizeBytes: 1024,
          rawText: JSON.stringify(payload),
          existingWorkflowNames: [],
          existingListIds: [],
          resolveActivityById,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('.json')) {
          throw new Error(`unexpected error: ${message}`)
        }
        return
      }

      throw new Error('expected .json validation failure')
    },
  },
  {
    name: 'negative unknown activity ID fails hard',
    run: () => {
      const payload = makeValidEnvelope('activity_does_not_exist')
      try {
        validateWorkflowImport({
          fileName: 'workflow.json',
          fileSizeBytes: 1024,
          rawText: JSON.stringify(payload),
          existingWorkflowNames: [],
          existingListIds: [],
          resolveActivityById,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('Unknown activity IDs')) {
          throw new Error(`unexpected error: ${message}`)
        }
        return
      }

      throw new Error('expected unknown activity validation failure')
    },
  },
  {
    name: 'negative missing edge endpoint fails',
    run: () => {
      const payload = makeValidEnvelope()
      payload.workflow.edges = [{ id: 'edge_bad', source: 'start_node', target: 'missing_node' }]
      try {
        validateWorkflowImport({
          fileName: 'workflow.json',
          fileSizeBytes: 1024,
          rawText: JSON.stringify(payload),
          existingWorkflowNames: [],
          existingListIds: [],
          resolveActivityById,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('missing node IDs')) {
          throw new Error(`unexpected error: ${message}`)
        }
        return
      }

      throw new Error('expected missing endpoint validation failure')
    },
  },
  {
    name: 'negative empty graph or missing start node fails',
    run: () => {
      const payload = makeValidEnvelope()
      payload.workflow.nodes = [
        {
          id: 'node_1',
          type: 'activity',
          position: { x: 280, y: 100 },
          data: {
            activityId: 'start_browser',
            label: 'Start Browser',
            config: {},
          },
        },
      ]
      payload.workflow.edges = []

      try {
        validateWorkflowImport({
          fileName: 'workflow.json',
          fileSizeBytes: 1024,
          rawText: JSON.stringify(payload),
          existingWorkflowNames: [],
          existingListIds: [],
          resolveActivityById,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('start node')) {
          throw new Error(`unexpected error: ${message}`)
        }
        return
      }

      throw new Error('expected missing start-node validation failure')
    },
  },
  {
    name: 'negative file size cap fails',
    run: () => {
      const payload = makeValidEnvelope()
      try {
        validateWorkflowImport({
          fileName: 'workflow.json',
          fileSizeBytes: WORKFLOW_IMPORT_MAX_FILE_BYTES + 1,
          rawText: JSON.stringify(payload),
          existingWorkflowNames: [],
          existingListIds: [],
          resolveActivityById,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('File is too large')) {
          throw new Error(`unexpected error: ${message}`)
        }
        return
      }

      throw new Error('expected file size validation failure')
    },
  },
  {
    name: 'negative node cap fails',
    run: () => {
      const payload = makeValidEnvelope()
      payload.workflow.nodes = Array.from({ length: WORKFLOW_IMPORT_MAX_NODES + 1 }, (_, index) => {
        if (index === 0) {
          return {
            id: 'start_node',
            type: 'start',
            position: { x: 100, y: 100 },
            data: { label: 'Start' },
          }
        }

        return {
          id: `node_${index}`,
          type: 'activity',
          position: { x: 100 + index, y: 100 },
          data: {
            activityId: 'start_browser',
            label: `Node ${index}`,
            config: {},
          },
        }
      })
      payload.workflow.edges = []

      try {
        validateWorkflowImport({
          fileName: 'workflow.json',
          fileSizeBytes: 1024,
          rawText: JSON.stringify(payload),
          existingWorkflowNames: [],
          existingListIds: [],
          resolveActivityById,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes(`workflow.nodes exceeds cap (${WORKFLOW_IMPORT_MAX_NODES})`)) {
          throw new Error(`unexpected error: ${message}`)
        }
        return
      }

      throw new Error('expected node cap validation failure')
    },
  },
]

let passed = 0
for (const scenario of scenarios) {
  try {
    scenario.run()
    passed += 1
    console.log(`PASS: ${scenario.name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`FAIL: ${scenario.name} -> ${message}`)
    process.exitCode = 1
  }
}

console.log(`\n${passed}/${scenarios.length} scenarios passed`)
