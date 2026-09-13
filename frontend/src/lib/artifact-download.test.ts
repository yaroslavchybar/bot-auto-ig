import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactDownloadPath } from './artifact-download'

test('local downloads use registered artifact IDs; cloud downloads still use storage IDs', () => {
  const local = new URL(artifactDownloadPath({ workflowId: 'workflow', artifactId: 'artifact' }, 'file.json'), 'http://localhost')
  assert.equal(local.searchParams.get('artifactId'), 'artifact')
  assert.equal(local.searchParams.get('workflowId'), 'workflow')
  const cloud = new URL(artifactDownloadPath({ storageId: 'storage' }, 'file.json'), 'http://localhost')
  assert.equal(cloud.searchParams.get('storageId'), 'storage')
  assert.throws(() => artifactDownloadPath({}, 'file.json'), /not available/)
})
