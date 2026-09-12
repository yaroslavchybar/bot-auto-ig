import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright-core'
import type { DbProfileRow } from '../shared/convexClient.js'
import { scrapeRelationships } from './scrape.js'

test('scraping resumes a saved cursor and keeps prior users after interruption', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ig-bot-scrape-test-'))
  const originalFetch = globalThis.fetch
  const cursors: Array<string | null> = []
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    assert.match(String(url), /\/(increment-daily-scraping-used|upsert)$/)
    return Response.json({})
  }) as typeof fetch
  const page = {
    goto: async () => {},
    locator: () => ({ first: () => ({ click: async () => {} }) }),
    evaluate: async (_callback: unknown, args: { cursor: string | null }) => {
      cursors.push(args.cursor)
      return args.cursor
        ? {
            users: [
              { pk: '1', username: 'alice' },
              { pk: '2', username: 'bob' },
            ],
            cursor: null,
          }
        : { users: [{ pk: '1', username: 'alice' }], cursor: 'next' }
    },
  } as unknown as Page
  const state: Record<string, any> = {}
  const input = {
    page,
    profile: {
      name: 'test',
      profile_id: 'test',
      Using: false,
      login: true,
      test_ip: false,
    } as DbProfileRow,
    workflowId: 'test',
    workflowName: 'Test',
    nodeId: 'scrape',
    config: { targets: ['target'], openDelaySeconds: 0 },
    state,
    artifactRoot: root,
  }
  try {
    await assert.rejects(
      scrapeRelationships({
        ...input,
        onProgress: () => {
          throw new Error('Interrupted')
        },
      }),
      /Interrupted/,
    )
    await scrapeRelationships({ ...input, onProgress: () => {} })
    assert.deepEqual(cursors, [null, 'next'])
    const files = await fs.readdir(root)
    assert.equal(files.length, 1)
    const artifact = JSON.parse(
      await fs.readFile(path.join(root, files[0]), 'utf8'),
    )
    assert.deepEqual(
      artifact.users.map((user: { username: string }) => user.username),
      ['alice', 'bob'],
    )
    assert.equal(artifact.progress.completed, true)
    assert.equal(state.completed, true)
  } finally {
    globalThis.fetch = originalFetch
    await fs.rm(root, { recursive: true, force: true })
  }
})
