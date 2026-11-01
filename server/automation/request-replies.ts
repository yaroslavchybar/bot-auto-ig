import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { routineRequestReplyPlan, routinePrepareRequestReply, routineBeginRequestReply, routineFinishRequestReply,
  routineRecordExistingDm,
  type RequestReplyIdentity as RequestIdentity } from '../shared/convexClient.js'
import { renderOutreachMessages } from '../shared/outreachMessage.js'
import { logOperation } from '../shared/logger.js'
import { BrowseSession, SessionEnded } from './actions/session.js'
import { clickLiveAction } from './actions/action-locator.js'
import { assertInstagramReady } from './actions/instagram-state.js'
import { backToFeed } from './actions/navigation.js'
import { isTemporaryUiError } from './actions/ui-errors.js'
import type { ActionLogger } from './actions/shared.js'
import { outreachMessagePopup, typeOutreachMessage, sendOutreachMessage, ownMessageState, outgoingMessageText } from './outreach-message.js'
import { messageWasBlocked } from './follow.js'

const dependencies = {
  plan: routineRequestReplyPlan, prepare: routinePrepareRequestReply,
  begin: routineBeginRequestReply, finish: routineFinishRequestReply,
  type: typeOutreachMessage, send: sendOutreachMessage, blocked: messageWasBlocked,
  check: assertInstagramReady, home: backToFeed, history: ownMessageState, recordExisting: routineRecordExistingDm,
  accept: acceptRequest, identity: requestIdentity,
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Thread list', exact: true })
export const requestControl = (page: Page) => nav(page)
  .getByRole('tab', { name: /^Requests?(?:\s*\(\d+\))?$/i })
  .or(nav(page).locator('a[href="/direct/requests/"]')).filter({ visible: true }).first()
const requestRows = (page: Page) => nav(page).locator('[role="button"]').filter({
  has: page.locator('img[alt="user-profile-picture"]'),
})
const sameIdentity = (a: RequestIdentity, b: RequestIdentity) => a.threadId === b.threadId && a.username === b.username

export class RequestIdentityError extends Error {
  override name = 'RequestIdentityError'
}

/** Only read the thread header, never a username mentioned inside a received message. */
export async function requestIdentity(page: Page): Promise<RequestIdentity> {
  const threadId = new URL(page.url()).pathname.match(/^\/direct\/t\/(\d{1,40})\/?$/)?.[1]
  const header = page.locator('main a[aria-label^="Open the profile page of "]').filter({ has: page.locator('h2') }).first()
  const href = await header.getAttribute('href')
  const username = href?.match(/^\/([\w.]{1,30})\/?$/)?.[1].toLowerCase()
  if (!threadId || !username) throw new RequestIdentityError('Message request identity unavailable')
  return { threadId, username }
}

export async function openRequests(page: Page, session: BrowseSession): Promise<boolean> {
  session.check()
  const inbox = page.locator('a[href="/direct/inbox/"]:has(svg[aria-label="Messages"])').filter({ visible: true }).first()
  await clickLiveAction(page, inbox, session, 10_000)
  await nav(page).waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  const control = requestControl(page)
  try { await control.waitFor({ state: 'visible', timeout: session.timeout(5000) }) }
  catch (error) { session.check(); if (error instanceof errors.TimeoutError) return false; throw error }
  await clickLiveAction(page, control, session, 10_000)
  await nav(page).getByText('Message requests', { exact: true }).waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  const empty = nav(page).getByText('Chats will appear here after you send or receive a message', { exact: true })
  await requestRows(page).first().or(empty).first().waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  session.check()
  return true
}

/** Accept first, including Instagram's Primary/General picker, then verify the same recipient's editor. */
export async function acceptRequest(page: Page, identity: RequestIdentity, session: BrowseSession) {
  session.check()
  if (!sameIdentity(await requestIdentity(page), identity)) throw new RequestIdentityError('Message request identity changed')
  const accept = page.getByRole('button', { name: 'Accept', exact: true })
  const composer = outreachMessagePopup(page, identity.username).getByRole('textbox')
  await accept.or(composer).first().waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  if (await accept.isVisible()) {
    await clickLiveAction(page, accept, session, 10_000)
    const picker = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Move messages from ${identity.username} into:`, exact: true }) })
    const primary = picker.getByRole('button', { name: 'Primary', exact: true })
    await primary.or(composer).first().waitFor({ state: 'visible', timeout: session.timeout(10_000) })
    session.check()
    if (await primary.isVisible()) await clickLiveAction(page, primary, session, 10_000)
  }
  await composer.waitFor({ state: 'visible', timeout: session.timeout(15_000) })
  session.check()
  if (!sameIdentity(await requestIdentity(page), identity)) throw new RequestIdentityError('Accepted request identity changed')
  return composer
}

/** One saved-message reply per incoming request; accepted-but-unsent work survives interruptions. */
export async function replyToMessageRequests(automationId: string, profileId: string, page: Page,
  session: BrowseSession, log: ActionLogger, deps = dependencies) {
  const context = { automationId, profileId }
  session.check()
  const plan = await deps.plan(context)
  session.check()
  if (!plan) return
  if (plan.uncertain) throw new Error('Delivery needs review: An earlier request reply could not be confirmed')
  const pending = [...plan.pending], visited = new Set<string>()
  let failed = false, rowOffset = 0
  try {
    for (let step = 0; step < 10 && session.end - Date.now() >= 20_000; step++) {
      session.check()
      let identity = pending.shift()
      const resuming = !!identity
      if (identity) {
        await page.goto(`https://www.instagram.com/direct/t/${identity.threadId}/`, {
          waitUntil: 'domcontentloaded', timeout: session.timeout(15_000),
        })
      } else {
        if (!await openRequests(page, session)) break
        const rows = requestRows(page).filter({ visible: true })
        if (rowOffset >= await rows.count()) break
        await clickLiveAction(page, rows.nth(rowOffset), session, 10_000)
      }
      await page.locator('main a[aria-label^="Open the profile page of "] h2').first()
        .waitFor({ state: 'visible', timeout: session.timeout(10_000) })
      const current = await deps.identity(page)
      if (identity && !sameIdentity(current, identity)) throw new RequestIdentityError('Pending request recipient changed')
      identity = current
      if (visited.has(identity.threadId)) break
      visited.add(identity.threadId)
      const args = { ...context, ...identity }
      await logOperation('automation.request_reply', { ...context, threadId: identity.threadId, targetUsername: identity.username }, async scope => {
        if (!await deps.prepare(args)) {
          if (!resuming) rowOffset++
          scope.add({ outcome: 'skipped', result: 'not_eligible' }); return
        }
        const composer = await deps.accept(page, identity, session)
        const history = await deps.history(page, identity.username, session)
        session.check()
        if (!sameIdentity(await deps.identity(page), identity)) throw new RequestIdentityError('Request recipient changed before history reconciliation')
        if (history.hasOwnMessage) {
          const recorded = await deps.recordExisting(args)
          scope.add({ outcome: 'skipped', result: 'existing_outgoing_message', recorded }); return
        }
        const messages = renderOutreachMessages(plan.message, identity)
        scope.add({ messageCount: messages.length, confirmedMessages: 0 })
        await deps.type(composer, messages[0], session)
        await deps.check(page, session)
        session.check()
        if (!sameIdentity(await deps.identity(page), identity)) throw new RequestIdentityError('Request recipient changed before Send')
        // An unacknowledged claim is never safe to retry automatically.
        let authorized: boolean
        try { authorized = await deps.begin(args) }
        catch (error) { throw new Error('Delivery authorization needs review: Request reply claim was not acknowledged', { cause: error }) }
        if (!authorized) {
          await deps.type(composer, '', session)
          scope.add({ outcome: 'skipped', result: 'not_authorized' }); return
        }
        let sent = false, blocked = false, deliveryError: Error | undefined
        try {
          let confirmedMessages = 0
          for (const [index, message] of messages.entries()) {
            session.check()
            if (index > 0) {
              await deps.type(composer, message, session)
              await deps.check(page, session)
            }
            session.check()
            if (!sameIdentity(await deps.identity(page), identity)) throw new RequestIdentityError('Request recipient changed during message sequence')
            const text = outgoingMessageText(page, identity.username, history.ownUsername, message)
            const previousMessages = await text.count()
            session.check()
            await deps.send(page, identity.username, session)
            await text.nth(previousMessages).waitFor({ state: 'visible', timeout: 15_000 })
            blocked = await deps.blocked(page)
            if (blocked) break
            confirmedMessages++
            scope.add({ confirmedMessages })
          }
          sent = confirmedMessages === messages.length
          scope.add({ sent, blocked, outcome: sent ? 'success' : 'rejected' })
        } catch (error) {
          deliveryError = new Error('Delivery needs review: Request reply could not be confirmed', { cause: error })
        }
        try { await deps.finish({ ...args, sent, blocked }) }
        catch (error) { throw new AggregateError(deliveryError ? [deliveryError, error] : [error],
          'Delivery result needs review: Request reply result could not be saved') }
        if (deliveryError) throw deliveryError
      })
    }
  } catch (error) {
    failed = true
    if (error instanceof Error && /Delivery.*review/.test(error.message)) throw error
    session.check()
    if (!(error instanceof RequestIdentityError) && !isTemporaryUiError(error) && !(error instanceof SessionEnded)) throw error
    await deps.check(page, session)
    log({ event: 'automation.request_replies_skipped', error, outcome: 'skipped' })
    failed = false
  } finally {
    if (!failed && !session.stopped()) await deps.home(page, log, session)
  }
}
