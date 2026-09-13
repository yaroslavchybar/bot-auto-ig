import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { localArtifactFile } from './artifacts.js'

test('local artifacts resolve registered files and reject missing, deleted and escaping paths', async () => {
  const originalFetch = globalThis.fetch
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ig-artifact-test-'))
  const relative = `scrapes/${'a'.repeat(64)}.json`
  const artifact = { _id: 'artifact', localArtifactPath: relative, localArtifactDeletedAt: undefined as number | undefined }
  globalThis.fetch = (async () => Response.json([artifact])) as typeof fetch
  try {
    await fs.mkdir(path.join(root, 'scrapes'))
    await fs.writeFile(path.join(root, relative), '{"users":[]}')
    assert.equal(await localArtifactFile('workflow', 'artifact', root), await fs.realpath(path.join(root, relative)))
    await assert.rejects(localArtifactFile('workflow', 'unknown', root), /not available/)
    artifact.localArtifactPath = '../secret.json'
    await assert.rejects(localArtifactFile('workflow', 'artifact', root), /Invalid artifact path/)
    artifact.localArtifactPath = `scrapes/${'b'.repeat(64)}.json`
    await assert.rejects(localArtifactFile('workflow', 'artifact', root), /not available/)
    artifact.localArtifactPath = relative
    artifact.localArtifactDeletedAt = 1
    await assert.rejects(localArtifactFile('workflow', 'artifact', root), /not available/)
  } finally {
    globalThis.fetch = originalFetch
    await fs.rm(root, { recursive: true, force: true })
  }
})
