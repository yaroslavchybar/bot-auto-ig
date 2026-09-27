import { afterAll, expect, test } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { apiLimiter, modelImageLimiter } from './rate-limit.js'

const app = express()
app.use('/api/ig-accounts', apiLimiter)
app.get('/api/ig-accounts/models/:modelId/content/:kind/:contentId/image',
  modelImageLimiter, (_req, res) => res.send('image'))
app.get('/api/ig-accounts/warmup', (_req, res) => res.json([]))

let server: Server | undefined
afterAll(() => server?.close())

test('gallery images have their own limit and do not exhaust the general API quota', async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server!.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start')
  const origin = `http://127.0.0.1:${address.port}`
  const image = `${origin}/api/ig-accounts/models/model-1/content/posts/image-1/image`
  const responses = await Promise.all(Array.from({ length: 120 }, () => fetch(image)))
  expect(responses.every(response => response.status === 200)).toBe(true)

  const warmup = `${origin}/api/ig-accounts/warmup`
  for (let index = 0; index < 100; index++) {
    expect((await fetch(warmup)).status).toBe(200)
  }
  expect((await fetch(warmup)).status).toBe(429)
})
