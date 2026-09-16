import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { activeDisplays, workflowWorkers } from '../shared/store.js'
import { AppError } from '../shared/errors.js'
import clipboardRouter from './clipboard.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/', clipboardRouter)
  // Same translation as the global error middleware in index.ts.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } })
      return
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  })
  return app
}

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const app = buildApp()
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  }
}

const AGENT_PORT = 59991
const MANUAL_PORT = 59992

function seedDisplays(): void {
  activeDisplays.set(`wf-1:agent-profile`, {
    workflowId: 'wf-1',
    profileName: 'agent-profile',
    vncPort: AGENT_PORT,
    displayNum: 191,
    status: 'active',
  })
  activeDisplays.set(`manual:solo`, {
    workflowId: 'manual',
    profileName: 'solo',
    vncPort: MANUAL_PORT,
    displayNum: 192,
    status: 'active',
  })
}

function clearSeeds(): void {
  activeDisplays.delete(`wf-1:agent-profile`)
  activeDisplays.delete(`manual:solo`)
  workflowWorkers.delete('wf-1')
}

test('clipboard writes are denied while an agent controls the session', async () => {
  seedDisplays()
  workflowWorkers.set('wf-1', { process: {} as never, status: 'running', startedAt: Date.now() })
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/${AGENT_PORT}/clipboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'attacker text' }),
      })
      assert.equal(res.status, 409)
      const body = (await res.json()) as { error: { code: string } }
      assert.equal(body.error.code, 'AGENT_ACTIVE')
    })
  } finally {
    clearSeeds()
  }
})

test('clipboard writes pass the guard once the agent is gone', async () => {
  seedDisplays()
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/${AGENT_PORT}/clipboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      })
      // Guard passed — xclip itself fails here (no X display in test), but
      // never with the agent-control rejection.
      assert.notEqual(res.status, 409)
    })
  } finally {
    clearSeeds()
  }
})

test('clipboard routes validate the display port', async () => {
  await withServer(async (base) => {
    const bad = await fetch(`${base}/abc/clipboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x' }),
    })
    assert.equal(bad.status, 400)
    const missing = await fetch(`${base}/59990/clipboard`)
    assert.equal(missing.status, 404)
  })
})
