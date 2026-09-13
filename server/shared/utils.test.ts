import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveProjectRoot } from './utils.js'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
test('source and compiled entrypoints share one project root', () => {
  for (const file of ['server/env.ts', 'server/shared/convexClient.ts', 'server/dist/env.js', 'server/dist/shared/convexClient.js']) {
    assert.equal(resolveProjectRoot(pathToFileURL(path.resolve(file)).href), path.resolve('.'))
  }
})
