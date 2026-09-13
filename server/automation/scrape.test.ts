import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright-core'
import type { DbProfileRow } from '../shared/convexClient.js'
import { scrapeRelationships, fetchRelationshipPage } from './scrape.js'
import { artifactJson } from '../workflows/artifact-stream.js'

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
      id: 'test',
      using: false,
      login: true,
      testIp: false,
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
    const filename = path.join(root, files.find(file => file.endsWith('.json'))!)
    const checkpoint = JSON.parse(await fs.readFile(filename, 'utf8'))
    assert.equal(checkpoint.users, undefined)
    assert.equal(checkpoint.progress.users, undefined)
    assert.equal(checkpoint.progress.chunks, 2)
    // A crash can leave a chunk beyond the checkpoint. Downloads ignore it.
    await fs.writeFile(path.join(`${filename}.chunks`, '2.json'), JSON.stringify([{ username: 'uncommitted' }]))
    let download = ''
    for await (const part of artifactJson(filename)) download += part
    const artifact = JSON.parse(download)
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

test('relationship pagination resolves metadata once per target', async () => {
  const originalFetch = globalThis.fetch
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const calls: string[] = []
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } })
  globalThis.fetch = (async url => {
    calls.push(String(url))
    return Response.json(String(url).includes('web_profile_info')
      ? { data: { user: { id: '123', edge_followed_by: { count: 2 } } } }
      : { users: [{ pk: '1' }], next_max_id: 'next' })
  }) as typeof fetch
  const page = { evaluate: async (fn: (args: unknown) => unknown, args: unknown) => fn(args) } as unknown as Page
  try {
    const target = {}
    await fetchRelationshipPage(page, 'alice', 'followers', null, 200, target)
    await fetchRelationshipPage(page, 'alice', 'followers', 'next', 200, target)
    assert.equal(calls.length, 3)
    assert.equal(calls.filter(url => url.includes('web_profile_info')).length, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
