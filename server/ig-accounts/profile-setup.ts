import type { Page } from 'playwright-core'
import WebSocket from 'ws'
import {
  editProfileInBrowser,
  type ProfileEditTask,
  type ProfileEditResult,
} from '../automation/actions/profile-edit.js'
import type { ActionLogger, StopCheck } from '../automation/actions/shared.js'
import { runtimeHeaders, runtimeUrl } from '../shared/runtime.js'
import { shutdownSignal } from '../browser/lifecycle.js'

/** The native lease holds the account lock until the browser stops and its result is saved. */
function setupStep(
  profileId: string,
  automationId: string,
  page: Page,
  log: ActionLogger,
  shouldStop: StopCheck,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted || shouldStop()) return Promise.resolve(false)
  return new Promise((resolve) => {
    const socket = new WebSocket(runtimeUrl().replace(/^http/, 'ws') + '/accounts/setup-lease', {
      headers: runtimeHeaders(),
      maxPayload: 8192,
      handshakeTimeout: 5_000,
    })
    let settled = false,
      cancelled = false,
      running = false,
      closing = false,
      awaitingSave = false,
      requestSent = false,
      cancellationSent = false,
      applied = false
    let acknowledgementTimer: ReturnType<typeof setTimeout> | undefined
    let lastTask = ''
    const finish = (saved = false) => {
      if (settled) return
      if (running) {
        cancelled = true
        closing = true
        return
      }
      settled = true
      clearTimeout(timer)
      clearTimeout(acknowledgementTimer)
      signal.removeEventListener('abort', abort)
      socket.terminate()
      resolve(saved && applied && !cancelled)
    }
    const timer = setTimeout(() => finish(), 610_000)
    const awaitAcknowledgement = () => {
      acknowledgementTimer ??= setTimeout(() => finish(), 10_000)
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
      else if (!running) finish()
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    socket.on('open', () => {
      if (!settled && !cancelled) {
        requestSent = true
        socket.send(JSON.stringify({ profileId, automationId }))
      }
    })
    socket.on('error', error => {
      if (!cancelled) log({ event: 'model.setup', profileId, automationId, stage: 'lease', error, outcome: 'error' })
      finish()
    })
    socket.on('close', () => finish())
    socket.on('message', (raw) => {
      void (async () => {
        if (settled || closing) return
        const value = JSON.parse(raw.toString()) as {
          ready?: boolean
          saved?: boolean
          error?: string
          task?: ProfileEditTask | null
        }
        if (value.error || value.saved || !value.task) {
          finish(value.saved === true)
          return
        }
        if (cancellationSent) return
        const identity = JSON.stringify([value.task.kind, value.task.value, value.task.path])
        if (!value.ready || running || identity === lastTask) return
        lastTask = identity
        awaitingSave = false
        if (cancelled || shouldStop()) {
          cancelled = awaitingSave = true
          awaitAcknowledgement()
          socket.send(JSON.stringify({ result: 'failed', cancelled: true }))
          return
        }
        running = true
        let result: ProfileEditResult = 'uncertain'
        try {
          result = await editProfileInBrowser(
            page,
            value.task,
            log,
            () => cancelled || shouldStop(),
          )
        } catch (error) {
          log({ event: 'model.setup', profileId, automationId, stage: 'edit', error, outcome: 'error' })
        } finally {
          running = false
        }
        if (result === 'applied') applied = true
        if (!closing && socket.readyState === WebSocket.OPEN) {
          cancelled ||= signal.aborted || shouldStop()
          awaitingSave = true
          if (cancelled) awaitAcknowledgement()
          socket.send(JSON.stringify({ result, ...(cancelled ? { cancelled: true } : {}) }))
        } else finish()
      })().catch(error => {
        log({ event: 'model.setup', profileId, automationId, stage: 'lease_message', error, outcome: 'error' })
        finish()
      })
    })
  })
}

/** Complete due identity edits and the profile picture before posting, in the same browser. */
export async function setupModelInSession(
  profileId: string,
  automationId: string,
  page: Page,
  log: ActionLogger,
  shouldStop: StopCheck,
  signal: AbortSignal = shutdownSignal,
): Promise<boolean> {
  let applied = false
  for (let step = 0; step < 3 && !shouldStop(); step++) {
    if (!(await setupStep(profileId, automationId, page, log, shouldStop, signal))) break
    applied = true
  }
  return applied
}
