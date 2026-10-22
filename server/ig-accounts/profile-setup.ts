import type { Page } from 'playwright-core'
import WebSocket from 'ws'
import {
  editProfileInBrowser,
  type ProfileEditTask,
  type ProfileEditResult,
} from '../automation/actions/profile-edit.js'
import type { ActionLogger, StopCheck } from '../automation/actions/shared.js'
import { runtimeHeaders, runtimeUrl } from '../shared/runtime.js'

/** The native lease holds the account lock until the browser stops and its result is saved. */
function setupStep(
  profileId: string,
  automationId: string,
  page: Page,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(runtimeUrl().replace(/^http/, 'ws') + '/accounts/setup-lease', {
      headers: runtimeHeaders(),
      maxPayload: 8192,
    })
    let settled = false,
      cancelled = false,
      running = false,
      applied = false
    let lastTask = ''
    const finish = (saved = false) => {
      if (settled) return
      if (running) {
        cancelled = true
        return
      }
      settled = true
      clearTimeout(timer)
      socket.terminate()
      resolve(saved && applied && !cancelled)
    }
    const timer = setTimeout(() => finish(), 610_000)
    socket.on('open', () => socket.send(JSON.stringify({ profileId, automationId })))
    socket.on('error', error => {
      log({ event: 'model.setup', profileId, automationId, stage: 'lease', error, outcome: 'error' })
      finish()
    })
    socket.on('close', () => finish())
    socket.on('message', (raw) => {
      void (async () => {
        if (settled || cancelled) return
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
        const identity = JSON.stringify([value.task.kind, value.task.value, value.task.path])
        if (!value.ready || running || identity === lastTask) return
        lastTask = identity
        running = true
        let result: ProfileEditResult = 'failed'
        try {
          result = await editProfileInBrowser(
            page,
            value.task,
            log,
            () => cancelled || shouldStop(),
          )
        } finally {
          running = false
        }
        if (result === 'applied') applied = true
        if (!cancelled && socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ result }))
        else finish()
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
): Promise<boolean> {
  let applied = false
  for (let step = 0; step < 3 && !shouldStop(); step++) {
    if (!(await setupStep(profileId, automationId, page, log, shouldStop))) break
    applied = true
  }
  return applied
}
