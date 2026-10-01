import { automationsGetById, automationsList, igAccountRequest, listsList, profilesList, routineReady } from '../shared/convexClient.js'
import logger, { logOperation, addLogContext } from '../shared/logger.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright-core'
import { publishFeedPost } from '../automation/actions/publish.js'
import type { ActionLogger, StopCheck } from '../automation/actions/shared.js'
import { accountForProfile, setAccountUsername } from './store.js'
import { allocateContent } from './content.js'
import { runMobileAction } from './mobile.js'
import { fullNameForGroup, usernameCandidates } from './usernames.js'
import { syncConnectedProfileName } from './profileName.js'
import { connectScheduledMobile } from './login.js'

type PendingAction = { kind: 'name' | 'username' | 'fullName' | 'avatar' | 'post'; sourceId?: string; date: string }
type Progress = { profileId: string; modelId: string; startedAt: number; targetUsername?: string;
  fullName?: string; nameDone?: boolean; fullNameDone?: boolean;
  avatarSourceId?: string; avatarDone?: boolean;
  postSourceIds: string[]; postDates: string[]; postTarget?: number; outreachReadyMarked?: boolean;
  pending?: PendingAction; error?: string }
let running = false
const activeActions = new Set<string>()

async function read(): Promise<{ profiles: Progress[] }> {
  return { profiles: await igAccountRequest<Progress[]>('modelSetupList') }
}

export async function startModelWarmup(profileId: string, modelId: string, startedAt = Date.now()): Promise<void> {
  await igAccountRequest('modelSetupEnroll', { profileId, modelId, startedAt })
}

/** A pending Instagram request has an unknown result until an operator checks the account. */
export async function reconcileModelWarmup(profileId: string, resolution: 'completed' | 'failed'): Promise<void> {
  if (activeActions.has(profileId)) throw new Error('Wait for the current Instagram request to finish')
  const state = (await read()).profiles.find(row => row.profileId === profileId)
  if (!state?.pending) throw new Error('No model setup action needs review')
  if (resolution === 'completed' && (state.pending.kind === 'username' || state.pending.kind === 'name')) {
    if (!state.targetUsername) throw new Error('The target username is missing')
    const account = await accountForProfile(profileId)
    if (!account) throw new Error('The IG account is missing')
    await setAccountUsername(account.id, state.targetUsername)
    await igAccountRequest('modelSetupReconcile', { profileId, resolution })
    await syncConnectedProfileName(profileId, account.id, state.targetUsername)
    return
  }
  await igAccountRequest('modelSetupReconcile', { profileId, resolution })
}

function dateKey(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', year: 'numeric',
    month: '2-digit', day: '2-digit' }).formatToParts(timestamp)
  const get = (kind: string) => parts.find(part => part.type === kind)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function dayNumber(startedAt: number, now: number): number {
  const start = Date.parse(`${dateKey(startedAt)}T00:00:00Z`)
  const today = Date.parse(`${dateKey(now)}T00:00:00Z`)
  return Math.floor((today - start) / 86_400_000) + 1
}

async function patch(profileId: string, values: Partial<Progress>): Promise<void> {
  const clear = Object.entries(values).filter(([, value]) => value === undefined).map(([key]) => key)
  const updates = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
  await igAccountRequest('modelSetupPatch', { profileId, patch: updates, clear })
}

async function groupName(modelId: string, group: number, model: Awaited<ReturnType<typeof listsList>>[number]): Promise<string> {
  const supplied = model.fullNames?.[group]?.trim()
  if (supplied) return supplied
  const existing = await igAccountRequest<string | null>('modelSetupGroupName', { modelId, group })
  if (existing) return existing
  const generated = await fullNameForGroup(model, group)
  return igAccountRequest<string>('modelSetupSaveGroupName', { modelId, group, name: generated })
}

async function applyUsername(state: Progress, model: Awaited<ReturnType<typeof listsList>>[number],
  index: number, profileName: string, reservedNames: Set<string>): Promise<void> {
  const account = await accountForProfile(state.profileId)
  if (!account) return
  const used = [...reservedNames].filter(name => name !== profileName.toLowerCase() &&
    name !== state.targetUsername?.toLowerCase())
  const candidates = state.targetUsername ? [state.targetUsername] : await usernameCandidates(model, index, used)
  for (let attempt = 0; attempt < Math.min(8, candidates.length); attempt++) {
    const candidate = candidates[attempt]
    reservedNames.add(candidate.toLowerCase())
    await patch(state.profileId, { pending: { kind: 'username', date: dateKey(Date.now()) },
      targetUsername: candidate })
    const result = await runMobileAction(state.profileId,
      { action: 'username', targetUsername: candidate })
    if (result.ok) {
      await setAccountUsername(account.id, candidate)
      await patch(state.profileId, { nameDone: true, pending: undefined, error: undefined,
        targetUsername: candidate })
      await syncConnectedProfileName(state.profileId, account.id, candidate)
      return
    }
    if (/username|taken|unavailable|exists/i.test(result.errorType)) {
      await patch(state.profileId, { pending: undefined, targetUsername: undefined })
      if (candidates.length === 1) candidates.push(...await usernameCandidates(model, index, [...used, candidate]))
      continue
    }
    await patch(state.profileId, { error: `Username update needs review (${result.errorType})` })
    return
  }
  await patch(state.profileId, { pending: undefined, error: 'No available username was accepted' })
}

async function applyFullName(state: Progress, model: Awaited<ReturnType<typeof listsList>>[number],
  index: number): Promise<void> {
  const fullName = state.fullName ?? await groupName(state.modelId, Math.floor(index / 4), model)
  await patch(state.profileId, { pending: { kind: 'fullName', date: dateKey(Date.now()) }, fullName })
  const result = await runMobileAction(state.profileId, { action: 'fullName', fullName })
  if (result.ok) {
    await patch(state.profileId, { fullNameDone: true, pending: undefined, error: undefined })
  } else await patch(state.profileId, { error: `Full-name update needs review (${result.errorType})` })
}

async function applyAvatar(state: Progress): Promise<boolean> {
  const account = await accountForProfile(state.profileId)
  if (!account) return false
  const content = await allocateContent(state.modelId, 'avatars', state.profileId)
  if (!content) return false
  await patch(state.profileId, { pending: { kind: 'avatar', sourceId: content.sourceId, date: dateKey(Date.now()) },
    avatarSourceId: content.sourceId })
  const result = await runMobileAction(state.profileId, { action: 'avatar', imagePath: content.path })
  if (result.ok) {
    await patch(state.profileId, { avatarDone: true, pending: undefined, error: undefined })
    return true
  }
  await patch(state.profileId, { error: `Avatar update needs review (${result.errorType})` })
  return false
}

/** Post today's photo on the live routine page, right after feed and DMs. True when shared. */
export async function postModelUpdateInSession(profileId: string, modelId: string,
  page: Page, log: ActionLogger, shouldStop: StopCheck = () => false): Promise<boolean> {
  return logOperation('model.post', { profileId, modelId }, async () => {
    addLogContext({ outcome: 'skipped' })
    if (activeActions.has(profileId)) return false
    activeActions.add(profileId)
    let posted: { sourceId: string; date: string } | undefined
    try {
      const state = (await read()).profiles.find(row => row.profileId === profileId && row.modelId === modelId)
      if (!state || state.pending || state.postSourceIds.length >= (state.postTarget ?? 9)) return false
      if (dayNumber(state.startedAt, Date.now()) < 4 || !state.avatarDone) return false
      const today = dateKey(Date.now())
      if (state.postDates.includes(today)) return false
      const content = await allocateContent(modelId, 'posts', profileId, state.postSourceIds)
      if (!content) return false
      const buffer = await fs.readFile(content.path)
      await patch(profileId, { pending: { kind: 'post', sourceId: content.sourceId, date: today } })
      addLogContext({ outcome: 'success', sourceId: content.sourceId, postDate: today })
      const steps: string[] = []
      const extension = path.extname(content.path).toLowerCase()
      const mimeType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
      const shared = await publishFeedPost(page,
        { name: path.basename(content.path), mimeType, buffer },
        fields => { if (fields.message) steps.push(fields.message); log(fields) }, shouldStop)
      if (!shared) {
        addLogContext({ outcome: 'paused', reason: 'post_needs_review' })
        const error = `Post result needs review (${steps.at(-1) ?? 'BrowserPostFailed'})`
        // Share clicked but unconfirmed may still have posted: keep pending for review.
        // Anything earlier never touched the account, so release the profile.
        if (steps.some(step => step.includes('share did not confirm'))) await patch(profileId, { error })
        else await patch(profileId, { pending: undefined, error })
        return false
      }
      const postSourceIds = [...state.postSourceIds, content.sourceId]
      addLogContext({ confirmedPostCount: postSourceIds.length })
      posted = { sourceId: content.sourceId, date: today }
      await patch(profileId, { pending: undefined, error: undefined,
        postSourceIds, postDates: [...state.postDates, today],
        ...(postSourceIds.length >= (state.postTarget ?? 9) ? { outreachReadyMarked: true } : {}) })
      return true
    } catch (error) {
      addLogContext({ outcome: 'error', error })
      logger.error({ event: 'ig-accounts.warmup.model_warmup_post_failed', profileId, error, message: 'Model warmup post failed', outcome: 'error' })
      try {
        if (posted) await patch(profileId, { pending: { kind: 'post', ...posted },
          error: 'Post shared but save failed — review before retrying (duplicate risk)' })
        else await patch(profileId, { error: error instanceof Error ? error.message : 'Warmup post failed' })
      }
      catch { logger.error({ event: 'ig-accounts.warmup.save_model_warmup_error', profileId, message: 'Could not save model warmup error', outcome: 'error' }) }
      return false
    } finally { activeActions.delete(profileId) }

  })
}

export async function sweepModelWarmup(): Promise<void> {
  return logOperation('model.enrollment', {}, async () => {
    if (running) return
    running = true
    try {
      const automations = await automationsList()
      const owners = new Map<string, string>()
      for (const automation of automations) {
        if (!automation.isActive || !automation.routine || automation.listIds?.length !== 1) continue
        const modelId = automation.listIds[0]
        if (modelId) owners.set(modelId, automation._id)
      }
      if (!owners.size) return
      const [profiles, existing] = await Promise.all([profilesList(), read()])
      const enrolled = new Map(existing.profiles.map(state => [state.profileId, state.modelId]))
      for (const profile of profiles) {
        try {
          if (!profile.igLoggedIn || profile.status === 'deleting') continue
          const modelId = profile.listIds?.find(id => owners.has(id))
          if (!modelId || enrolled.get(profile.id) === modelId) continue
          const account = await accountForProfile(profile.id)
          if (account?.browserLoggedInAt || account?.status === 'connected') {
            await startModelWarmup(profile.id, modelId, account.browserLoggedInAt ?? Date.now())
          }
        } catch {
          logger.error({ event: 'ig-accounts.warmup.enroll_profile_in_model_automation', profileId: profile.id, message: 'Could not enroll profile in model automation', outcome: 'error' })
        }
      }
    } finally { running = false }

  })
}

/** Continue this account's model setup only after its browser session has closed. */
export async function advanceModelWarmup(profileId: string, automationId: string): Promise<void> {
  return logOperation('model.setup', { profileId, automationId }, async () => {
    addLogContext({ outcome: 'skipped' })
    if (activeActions.has(profileId)) return
    activeActions.add(profileId)
    try {
      const [automation, profiles, snapshot, models] = await Promise.all([
        automationsGetById(automationId), profilesList(), read(), listsList(),
      ])
      const modelId = automation?.isActive && automation.routine && automation.listIds?.length === 1
        ? automation.listIds[0] : undefined
      const profile = profiles.find(row => row.id === profileId)
      if (!modelId || !profile || !profile.listIds?.includes(modelId) ||
        !profile.igLoggedIn || !profile.proxy || profile.using || profile.status === 'deleting') return
      const model = models.find(row => row.id === modelId)
      const account = await accountForProfile(profileId)
      if (!model || !account || (!account.browserLoggedInAt && account.status !== 'connected')) return
      let state = snapshot.profiles.find(row => row.profileId === profileId && row.modelId === modelId)
      if (!state) {
        await startModelWarmup(profileId, modelId, account.browserLoggedInAt ?? Date.now())
        state = (await read()).profiles.find(row => row.profileId === profileId && row.modelId === modelId)
      }
      if (!state || state.pending) return
      const now = Date.now()
      const day = dayNumber(state.startedAt, now)
      addLogContext({ modelId, profileName: profile.name, accountId: account.id, warmupDay: day,
        confirmedPostCount: state.postSourceIds.length })
      if (day < 3) return
      if (account.status !== 'connected') {
        if (!account.browserLoggedInAt || (account.retryAfter ?? 0) > now) return
        await connectScheduledMobile(profileId)
        if ((await accountForProfile(profileId))?.status !== 'connected') return
      }
      if (!await routineReady(automationId, profileId, true)) return
      addLogContext({ outcome: 'success' })
      const enrolledIds = new Set(snapshot.profiles.filter(row => row.modelId === modelId).map(row => row.profileId))
      enrolledIds.add(profileId)
      const index = profiles.filter(row => enrolledIds.has(row.id) && row.listIds?.includes(modelId))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .findIndex(row => row.id === profileId)
      if (index < 0) return
      if (!state.nameDone) {
        const reservedNames = new Set([
          ...profiles.map(row => row.name.toLowerCase()),
          ...snapshot.profiles.flatMap(row => row.targetUsername ? [row.targetUsername.toLowerCase()] : []),
        ])
        await applyUsername(state, model, index, profile.name, reservedNames)
        return
      }
      if (!state.fullNameDone && (state.fullName || model.fullName?.trim() ||
        model.fullNames?.some(name => name.trim()))) {
        await applyFullName(state, model, index)
        return
      }
      if (state.postSourceIds.length >= (state.postTarget ?? 9)) {
        if (!state.outreachReadyMarked)
          await patch(profileId, { outreachReadyMarked: true, error: undefined })
        return
      }
      if (day < 4) return
      if (!state.avatarDone && !await applyAvatar(state)) return
    } catch (error) {
      logger.error({ event: 'ig-accounts.warmup.model_warmup_step_failed', profileId, error, message: 'Model warmup step failed', outcome: 'error' })
      try { await patch(profileId, { error: error instanceof Error ? error.message : 'Warmup step failed' }) }
      catch { logger.error({ event: 'ig-accounts.warmup.save_model_warmup_error', profileId, message: 'Could not save model warmup error', outcome: 'error' }) }
      throw error
    } finally { activeActions.delete(profileId) }

  })
}

export function startModelWarmupWorker(): void {
  void sweepModelWarmup().catch(() => logger.error({ event: 'ig-accounts.warmup.start_model_warmup_sweep', message: 'Could not start model warmup sweep', outcome: 'error' }))
  setInterval(() => void sweepModelWarmup().catch(() => logger.error({ event: 'ig-accounts.warmup.model_warmup_sweep_failed', message: 'Model warmup sweep failed', outcome: 'error' })), 15 * 60_000).unref()
}

export async function listModelWarmup(): Promise<Progress[]> { return (await read()).profiles }
