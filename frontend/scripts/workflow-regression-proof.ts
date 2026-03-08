import { execSync } from 'node:child_process'
import fs from 'node:fs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function read(path: string) {
  return fs.readFileSync(path, 'utf8')
}

const changedFiles = execSync('git diff --name-only origin/main...HEAD', {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)

const runtimeProtocolFiles = [
  'server/api/workflows.ts',
  'convex/workflows.ts',
  'python/getting_started/run_workflow.py',
]

const touchedRuntimeProtocol = runtimeProtocolFiles.filter((file) =>
  changedFiles.includes(file),
)
assert(
  touchedRuntimeProtocol.length === 0,
  `Runtime protocol files changed unexpectedly: ${touchedRuntimeProtocol.join(', ')}`,
)

const workflowsPage = read('frontend/src/tabs/workflows/WorkflowsPage.tsx')
const workflowsList = read('frontend/src/tabs/workflows/WorkflowsList.tsx')

assert(
  workflowsPage.includes(
    'const createWorkflow = useMutation(api.workflows.create)',
  ),
  'create mutation wiring missing',
)
assert(
  workflowsPage.includes(
    'const updateWorkflow = useMutation(api.workflows.update)',
  ),
  'update mutation wiring missing',
)
assert(
  workflowsPage.includes(
    'const duplicateWorkflow = useMutation(api.workflows.duplicate)',
  ),
  'duplicate mutation wiring missing',
)
assert(
  workflowsPage.includes("apiFetch('/api/workflows/stop'"),
  'run/stop API wiring missing',
)
assert(
  workflowsPage.includes(
    'const created = await createWorkflow(imported.workflow)',
  ),
  'import must persist via createWorkflow',
)
assert(
  !workflowsPage.includes('await updateWorkflow(imported.workflow'),
  'import must not overwrite via updateWorkflow',
)
assert(
  workflowsList.includes('Export JSON') &&
    workflowsList.includes('onExport(workflow)} disabled={isRunning}'),
  'Export JSON must be disabled when running',
)

console.log('PASS: create/edit/duplicate/run wiring remains present')
console.log('PASS: runtime protocol files untouched by import/export change')
console.log('PASS: import remains create-only (no overwrite path)')
console.log('PASS: export action is running-state gated')
console.log(`PASS: changed-files-count=${changedFiles.length}`)
