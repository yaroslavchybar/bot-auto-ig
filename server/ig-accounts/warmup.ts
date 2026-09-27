import { automationsList, igAccountRequest, listsList, profilesList, routineReady } from '../shared/convexClient.js'
import logger from '../shared/logger.js'
import { accountForProfile, setAccountUsername } from './store.js'
import { allocateContent } from './content.js'
import { runMobileAction } from './mobile.js'
import { fullNameForGroup, usernameCandidates } from './usernames.js'
import { syncConnectedProfileName } from './profileName.js'
import { connectScheduledMobile } from './login.js'

type PendingAction = { kind: 'name' | 'avatar' | 'post'; sourceId?: string; date: string }
type Progress = { profileId: string; modelId: string; startedAt: number; targetUsername?: string;
  fullName?: string; nameDone?: boolean; avatarSourceId?: string; avatarDone?: boolean;
  postSourceIds: string[]; postDates: string[]; outreachReadyMarked?: boolean;
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
  if (resolution === 'completed' && state.pending.kind === 'name') {
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

async function applyName(state: Progress, model: Awaited<ReturnType<typeof listsList>>[number],
  index: number, profileName: string, reservedNames: Set<string>): Promise<void> {
  const account = await accountForProfile(state.profileId)
  if (!account) return
  const group = Math.floor(index / 4)
  const fullName = state.fullName ?? await groupName(state.modelId, group, model)
  const used = [...reservedNames].filter(name => name !== profileName.toLowerCase() &&
    name !== state.targetUsername?.toLowerCase())
  const candidates = state.targetUsername ? [state.targetUsername] : await usernameCandidates(model, index, used)
  for (let attempt = 0; attempt < Math.min(8, candidates.length); attempt++) {
    const candidate = candidates[attempt]
    reservedNames.add(candidate.toLowerCase())
    await patch(state.profileId, { pending: { kind: 'name', date: dateKey(Date.now()) },
      targetUsername: candidate, fullName })
    const result = await runMobileAction(state.profileId,
      { action: 'name', targetUsername: candidate, fullName })
    if (result.ok) {
      await setAccountUsername(account.id, candidate)
      await patch(state.profileId, { nameDone: true, pending: undefined, error: undefined,
        targetUsername: candidate, fullName })
      await syncConnectedProfileName(state.profileId, account.id, candidate)
      return
    }
    if (/username|taken|unavailable|exists/i.test(result.errorType)) {
      await patch(state.profileId, { pending: undefined, targetUsername: undefined })
      if (candidates.length === 1) candidates.push(...await usernameCandidates(model, index, [...used, candidate]))
      continue
    }
    await patch(state.profileId, { error: `Name update needs review (${result.errorType})` })
    return
  }
  await patch(state.profileId, { pending: undefined, error: 'No available username was accepted' })
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

async function applyPost(state: Progress, today: string): Promise<void> {
  const account = await accountForProfile(state.profileId)
  if (!account) return
  const content = await allocateContent(state.modelId, 'posts', state.profileId, state.postSourceIds)
  if (!content) return
  await patch(state.profileId, { pending: { kind: 'post', sourceId: content.sourceId, date: today } })
  const result = await runMobileAction(state.profileId, { action: 'post', imagePath: content.path })
  if (result.ok) {
    const postSourceIds = [...state.postSourceIds, content.sourceId]
    await patch(state.profileId, { pending: undefined, error: undefined,
      postSourceIds, postDates: [...state.postDates, today] })
  }
  else await patch(state.profileId, { error: `Post result needs review (${result.errorType})` })
}

export async function sweepModelWarmup(): Promise<void> {
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
    const [models, profiles, existing] = await Promise.all([listsList(), profilesList(), read()])
    const enrolled = new Map(existing.profiles.map(state => [state.profileId, state.modelId]))
    let enrolledAny = false
    for (const profile of profiles) {
      try {
        if (!profile.igLoggedIn || profile.status === 'deleting') continue
        const modelId = profile.listIds?.find(id => owners.has(id))
        if (!modelId || enrolled.get(profile.id) === modelId) continue
        const account = await accountForProfile(profile.id)
        if (account?.browserLoggedInAt || account?.status === 'connected') {
          await startModelWarmup(profile.id, modelId, account.browserLoggedInAt ?? Date.now())
          enrolledAny = true
        }
      } catch {
        logger.warn({ profileId: profile.id }, 'Could not enroll profile in model automation')
      }
    }
    const snapshot = enrolledAny ? await read() : existing
    const reservedNames = new Set([
      ...profiles.map(row => row.name.toLowerCase()),
      ...snapshot.profiles.flatMap(row => row.targetUsername ? [row.targetUsername.toLowerCase()] : []),
    ])
    const now = Date.now()
    const today = dateKey(now)
    for (const state of snapshot.profiles) {
      try {
        if (state.pending) continue
        const automationId = owners.get(state.modelId)
        if (!automationId) continue
        const day = dayNumber(state.startedAt, now)
        if (day < 3) continue
        const model = models.find(row => row.id === state.modelId)
        const profile = profiles.find(row => row.id === state.profileId)
        if (!model || !profile || !profile.listIds?.includes(model.id) ||
          !profile.igLoggedIn || !profile.proxy || profile.using) continue
        const account = await accountForProfile(state.profileId)
        if (!account) continue
        if (account.status !== 'connected') {
          if (!account.browserLoggedInAt || (account.retryAfter ?? 0) > now) continue
          await connectScheduledMobile(state.profileId)
          if ((await accountForProfile(state.profileId))?.status !== 'connected') continue
        }
        if (!await routineReady(automationId, state.profileId, true)) continue
        if (state.postSourceIds.length >= 9) {
          if (!state.outreachReadyMarked) {
            await patch(state.profileId, { outreachReadyMarked: true, error: undefined })
          }
          continue
        }
        const warmupIds = new Set(snapshot.profiles.filter(row => row.modelId === model.id).map(row => row.profileId))
        const modelProfiles = profiles.filter(row => warmupIds.has(row.id) && row.listIds?.includes(model.id))
          .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        const index = modelProfiles.findIndex(row => row.id === state.profileId)
        if (index < 0) continue
        if (!state.nameDone) {
          await trackedAction(state.profileId, () => applyName(state, model, index, profile.name, reservedNames))
          continue
        }
        if (day < 4) continue
        if (!state.avatarDone && !await trackedAction(state.profileId, () => applyAvatar(state))) continue
        if (!state.postDates.includes(today)) await trackedAction(state.profileId, () => applyPost(state, today))
      } catch (error) {
        logger.warn({ profileId: state.profileId }, 'Model warmup step failed')
        try { await patch(state.profileId, { error: error instanceof Error ? error.message : 'Warmup step failed' }) }
        catch { logger.warn({ profileId: state.profileId }, 'Could not save model warmup error') }
      }
    }
  } finally { running = false }
}

export function startModelWarmupWorker(): void {
  void sweepModelWarmup().catch(() => logger.warn('Could not start model warmup sweep'))
  setInterval(() => void sweepModelWarmup().catch(() => logger.warn('Model warmup sweep failed')), 15 * 60_000).unref()
}

export async function listModelWarmup(): Promise<Progress[]> { return (await read()).profiles }

async function trackedAction<T>(profileId: string, action: () => Promise<T>): Promise<T> {
  activeActions.add(profileId)
  try { return await action() }
  finally { activeActions.delete(profileId) }
}
