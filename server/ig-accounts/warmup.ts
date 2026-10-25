import type { Page } from 'playwright-core'
import WebSocket from 'ws'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { publishFeedPost } from '../automation/actions/publish.js'
import type { ActionLogger, StopCheck } from '../automation/actions/shared.js'
import { runtimeHeaders, runtimeUrl } from '../shared/runtime.js'
import logger from '../shared/logger.js'
import { shutdownSignal } from '../browser/lifecycle.js'

type Content = { sourceId: string; path: string }

/** Rust owns post eligibility, the action lease, and durable acknowledgement. */
export function postModelUpdateInSession(
  profileId: string,
  modelId: string,
  page: Page,
  log: ActionLogger,
  shouldStop: StopCheck = () => false,
  signal: AbortSignal = shutdownSignal,
): Promise<boolean> {
  if (signal.aborted || shouldStop()) return Promise.resolve(false)
  return new Promise((resolve) => {
    const socket = new WebSocket(runtimeUrl().replace(/^http/, 'ws') + '/accounts/post-lease', {
      headers: runtimeHeaders(),
      maxPayload: 4096,
      handshakeTimeout: 5_000,
    })
    let settled = false
    let cancelled = false
    let started = false
    let running = false
    let closing = false
    let awaitingSave = false
    let requestSent = false
    let cancellationSent = false
    let shared = false
    let acknowledgementTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => finish(false), 610_000)
    const finish = (result: boolean) => {
      if (settled) return
      if (running) {
        // The caller still owns the page until the browser action has stopped.
        cancelled = true
        closing = true
        return
      }
      settled = true
      clearTimeout(timer)
      clearTimeout(acknowledgementTimer)
      signal.removeEventListener('abort', abort)
      socket.terminate()
      resolve(result && !cancelled)
    }
    const awaitAcknowledgement = () => {
      acknowledgementTimer ??= setTimeout(() => finish(false), 10_000)
    }
    const abort = () => {
      // Stop browser work, then preserve its result until Rust acknowledges the save.
      cancelled = true
      if (requestSent && !running && socket.readyState === WebSocket.OPEN) {
        if (!cancellationSent) {
          cancellationSent = true
          socket.send(JSON.stringify({ cancel: true }))
        }
        awaitAcknowledgement()
      } else if (awaitingSave) awaitAcknowledgement()
      else if (!running) finish(false)
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    socket.on('open', () => {
      if (!settled && !cancelled) {
        requestSent = true
        socket.send(JSON.stringify({ profileId, modelId }))
      }
    })
    socket.on('error', error => {
      if (!cancelled) logger.error({ event: 'model.post', profileId, modelId, stage: 'lease', error })
      finish(false)
    })
    socket.on('close', () => finish(false))
    socket.on('message', (data) => {
      void (async () => {
        if (settled || closing) return
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
        if (cancellationSent) return
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
        } catch (error) {
          logger.error({
            event: 'model.post',
            profileId,
            outcome: 'error',
            message: 'Browser post failed',
            error,
          })
        } finally {
          running = false
        }
        if (!closing && socket.readyState === WebSocket.OPEN) {
          cancelled ||= signal.aborted || shouldStop()
          awaitingSave = true
          if (cancelled) awaitAcknowledgement()
          socket.send(JSON.stringify({ result, ...(cancelled ? { cancelled: true } : {}) }))
        } else finish(false)
      })().catch(error => {
        logger.error({ event: 'model.post', profileId, modelId, stage: 'lease_message', error })
        finish(false)
      })
    })
  })
}
