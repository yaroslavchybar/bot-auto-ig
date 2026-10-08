import type { Page } from 'playwright-core'
import WebSocket from 'ws'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { publishFeedPost } from '../automation/actions/publish.js'
import type { ActionLogger, StopCheck } from '../automation/actions/shared.js'
import { runtimeHeaders, runtimeUrl } from '../shared/runtime.js'
import logger from '../shared/logger.js'

type Content = { sourceId: string; path: string }

/** Rust owns post eligibility, the action lease, and durable acknowledgement. */
export function postModelUpdateInSession(
  profileId: string,
  modelId: string,
  page: Page,
  log: ActionLogger,
  shouldStop: StopCheck = () => false,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(runtimeUrl().replace(/^http/, 'ws') + '/accounts/post-lease', {
      headers: runtimeHeaders(),
      maxPayload: 4096,
    })
    let settled = false
    let cancelled = false
    let started = false
    let running = false
    let shared = false
    const timer = setTimeout(() => finish(false), 610_000)
    const finish = (result: boolean) => {
      if (settled) return
      if (running) {
        // The caller still owns the page until the browser action has stopped.
        cancelled = true
        return
      }
      settled = true
      clearTimeout(timer)
      socket.terminate()
      resolve(result)
    }
    socket.on('open', () => socket.send(JSON.stringify({ profileId, modelId })))
    socket.on('error', () => finish(false))
    socket.on('close', () => finish(false))
    socket.on('message', (data) => {
      void (async () => {
        if (settled || cancelled) return
        const value = JSON.parse(data.toString()) as {
          ready?: boolean
          saved?: boolean
          error?: string
          content?: Content | null
        }
        if (value.error) {
          logger.error({
            event: 'model.post',
            profileId,
            outcome: 'error',
            message: 'Post result needs review',
          })
          finish(false)
          return
        }
        if (value.saved) {
          finish(shared)
          return
        }
        if (!value.ready || started) return
        if (!value.content) {
          finish(false)
          return
        }
        started = running = true
        let result: 'shared' | 'failed' | 'uncertain' = 'failed'
        try {
          const content = value.content
          const buffer = await fs.readFile(content.path)
          if (cancelled || shouldStop()) throw new Error('Browser post stopped')
          const steps: string[] = []
          const extension = path.extname(content.path).toLowerCase()
          const mimeType =
            extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
          result = 'uncertain'
          shared = await publishFeedPost(
            page,
            { name: path.basename(content.path), mimeType, buffer },
            (fields) => {
              if (fields.message) steps.push(fields.message)
              log(fields)
            },
            () => cancelled || shouldStop(),
          )
          result = shared
            ? 'shared'
            : steps.some((step) => step.includes('share did not confirm'))
              ? 'uncertain'
              : 'failed'
        } catch {
          logger.error({
            event: 'model.post',
            profileId,
            outcome: 'error',
            message: 'Browser post failed',
          })
        } finally {
          running = false
        }
        if (!cancelled && socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ result }))
        else finish(false)
      })().catch(() => finish(false))
    })
  })
}
