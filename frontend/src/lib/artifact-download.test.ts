import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactDownloadPath } from './artifact-download'

test('downloads use registered artifact IDs', () => {
  const local = new URL(artifactDownloadPath({ workflowId: 'workflow', artifactId: 'artifact' }, 'file.json'), 'http://localhost')
  assert.equal(local.searchParams.get('artifactId'), 'artifact')
  assert.equal(local.searchParams.get('workflowId'), 'workflow')
  assert.throws(() => artifactDownloadPath({ workflowId: '', artifactId: '' }, 'file.json'), /not available/)
})
