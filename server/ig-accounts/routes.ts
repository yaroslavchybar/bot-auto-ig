import { Router, raw } from 'express'
import { asyncHandler } from '../shared/asyncHandler.js'
import { ValidationError } from '../shared/errors.js'
import { listsList, profilesCreateForModel, profilesGetById } from '../shared/convexClient.js'
import { parseChatCredentials } from '../chat/totp.js'
import { accountById, accountByUsername, assignAccount, availableAccounts, importAccounts, listAccounts } from './store.js'
import { listBlacklistedProxies } from './blacklist.js'
import { queueProfileLogin } from './login.js'
import { addContent, contentImage, copyImage, generateCopies, listContent, listCopies, removeContent, type ContentKind } from './content.js'
import { listModelWarmup, reconcileModelWarmup } from './warmup.js'
import { modelImageLimiter } from '../security/rate-limit.js'

const router = Router()

router.get('/', asyncHandler(async (_req, res) => {
  res.json(await listAccounts())
}))

router.get('/blacklist', asyncHandler(async (_req, res) => {
  res.json(await listBlacklistedProxies())
}))

router.get('/warmup', asyncHandler(async (_req, res) => {
  res.json(await listModelWarmup())
}))

router.post('/warmup/:profileId/reconcile', asyncHandler(async (req, res) => {
  const resolution = req.body?.resolution
  if (resolution !== 'completed' && resolution !== 'failed')
    throw new ValidationError('Choose completed or failed')
  try { await reconcileModelWarmup(req.params.profileId, resolution) }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Could not reconcile setup action') }
  res.json({ ok: true })
}))

router.get('/credentials/:id', asyncHandler(async (req, res) => {
  try {
    const account = await accountById(req.params.id)
    if (!account) throw new ValidationError('Credential not found')
    res.json({ id: account.id, username: account.username, password: account.password,
      authenticatorKey: account.authenticatorKey, status: account.status,
      profileId: account.profileId, error: account.error, createdAt: account.createdAt,
      retryAfter: account.retryAfter, browserLoggedInAt: account.browserLoggedInAt })
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : 'Credential not found')
  }
}))

router.get('/models/:modelId/content', asyncHandler(async (req, res) => {
  if (!(await listsList()).some(row => row.id === req.params.modelId)) throw new ValidationError('Model not found')
  res.json(await listContent(req.params.modelId))
}))

router.get('/models/:modelId/content/:kind/:contentId/image', modelImageLimiter, asyncHandler(async (req, res) => {
  if (!(await listsList()).some(row => row.id === req.params.modelId)) throw new ValidationError('Model not found')
  const kind = req.params.kind
  if (kind !== 'posts' && kind !== 'avatars') throw new ValidationError('Choose posts or avatars')
  const image = await contentImage(req.params.modelId, kind, req.params.contentId)
  if (!image) throw new ValidationError('Image not found')
  res.vary('Authorization').set('Cache-Control', 'private, max-age=3600')
    .type(image.type).send(image.bytes)
}))

router.post('/models/:modelId/content/:kind', raw({ type: 'application/octet-stream', limit: '15mb' }),
  asyncHandler(async (req, res) => {
    if (!(await listsList()).some(row => row.id === req.params.modelId)) throw new ValidationError('Model not found')
    const kind = req.params.kind
    if (kind !== 'posts' && kind !== 'avatars') throw new ValidationError('Choose posts or avatars')
    const name = String(req.query.name ?? '')
    try { res.json(await addContent(req.params.modelId, kind as ContentKind, name, req.body as Buffer)) }
    catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Could not process image') }
  }))

function contentKind(kind: unknown): ContentKind {
  if (kind !== 'posts' && kind !== 'avatars') throw new ValidationError('Choose posts or avatars')
  return kind
}

async function contentModel(modelId: string): Promise<void> {
  if (!(await listsList()).some(row => row.id === modelId)) throw new ValidationError('Model not found')
}

router.post('/models/:modelId/content/:kind/:contentId/copies', asyncHandler(async (req, res) => {
  await contentModel(req.params.modelId)
  const kind = contentKind(req.params.kind)
  try { res.json(await generateCopies(req.params.modelId, kind, req.params.contentId)) }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Could not generate copies') }
}))

router.get('/models/:modelId/content/:kind/:contentId/copies', asyncHandler(async (req, res) => {
  await contentModel(req.params.modelId)
  const kind = contentKind(req.params.kind)
  try { res.json(await listCopies(req.params.modelId, kind, req.params.contentId)) }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Image not found') }
}))

router.get('/models/:modelId/content/:kind/:contentId/copies/:variant/image', modelImageLimiter,
  asyncHandler(async (req, res) => {
    await contentModel(req.params.modelId)
    const kind = contentKind(req.params.kind)
    const image = await copyImage(req.params.modelId, kind, req.params.contentId, req.params.variant)
    if (!image) throw new ValidationError('Image not found')
    res.vary('Authorization').set('Cache-Control', 'private, max-age=3600')
      .type(image.type).send(image.bytes)
  }))

router.delete('/models/:modelId/content/:kind/:contentId', asyncHandler(async (req, res) => {
  await contentModel(req.params.modelId)
  const kind = contentKind(req.params.kind)
  try { res.json(await removeContent(req.params.modelId, kind, req.params.contentId)) }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Could not remove image') }
}))

router.post('/import', asyncHandler(async (req, res) => {
  if (typeof req.body?.text !== 'string') throw new ValidationError('Choose a TXT file')
  try { res.json(await importAccounts(req.body.text)) }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Invalid credentials') }
}))

router.post('/create-batch', asyncHandler(async (req, res) => {
  const modelId = String(req.body?.modelId ?? '')
  const count = Number(req.body?.count)
  if (!Number.isSafeInteger(count) || count < 1 || count > 100)
    throw new ValidationError('Choose 1–100 profiles')
  const model = (await listsList()).find(row => row.id === modelId)
  if (!model) throw new ValidationError('Choose a model')
  const accounts = await availableAccounts(count)
  if (accounts.length < count) throw new ValidationError(`Only ${accounts.length} unused credentials are available`)
  const created = await profilesCreateForModel(modelId,
    accounts.map(account => ({ id: account.id, username: account.username })))
  for (const row of created) queueProfileLogin(row.profileId)
  res.json({ created, count: created.length })
}))

router.post('/:profileId/connect', asyncHandler(async (req, res) => {
  const profile = await profilesGetById(req.params.profileId)
  if (!profile || !profile.igLoggedIn || profile.status === 'deleting')
    throw new ValidationError('Choose a logged-in profile')
  let account = typeof req.body?.credentialId === 'string'
    ? await accountById(req.body.credentialId) : undefined
  if (!account && typeof req.body?.credentials === 'string') {
    const parsed = parseChatCredentials(req.body.credentials)
    if (!parsed) throw new ValidationError('Enter username:password:2FA key')
    await importAccounts(req.body.credentials)
    account = await accountByUsername(parsed.username)
  }
  if (!account || (account.profileId && account.profileId !== profile.id))
    throw new ValidationError('Choose an available credential')
  await assignAccount(account.id, profile.id)
  queueProfileLogin(profile.id)
  res.status(202).json({ queued: true, username: account.username })
}))

export default router
