import {
  WORKFLOW_EXPORT_FORMAT,
  WORKFLOW_EXPORT_VERSION,
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
