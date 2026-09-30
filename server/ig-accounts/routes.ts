import { Commands } from '../worker/commands.js'
import { AppError, ValidationError } from '../shared/errors.js'
import { InstagramError } from '../chat/instagram.js'
import { listsList, profilesCreateForModel, profilesGetById } from '../shared/convexClient.js'
import { parseChatCredentials } from '../chat/totp.js'
import {
  accountById,
  accountByUsername,
  assignAccount,
  availableAccounts,
  availableAccountCount,
  importAccounts,
  listAccounts,
  listAccountsPage,
} from './store.js'
import { listBlacklistedProxies } from './blacklist.js'
import { queueProfileLogin } from './login.js'
import { reconnectAccount } from './reconnect.js'
import {
  addContent,
  contentImage,
  copyImage,
  generateCopies,
  listContent,
  listCopies,
  removeContent,
  type ContentKind,
} from './content.js'
import { listModelWarmup, reconcileModelWarmup } from './warmup.js'

const commands = new Commands()

commands.register(
  'ig-accounts.get.list',
  'GET',
  '/',
  async (_req, res) => {
    res.json(await listAccounts())
  },
  'json',
)

commands.register(
  'ig-accounts.get.page',
  'GET',
  '/page',
  async (req, res) => {
    const { search = '', cursor, profileId } = req.query
    if (
      typeof search !== 'string' ||
      search.length > 200 ||
      (cursor !== undefined && typeof cursor !== 'string') ||
      (profileId !== undefined && typeof profileId !== 'string')
    )
      throw new ValidationError('Invalid page parameters')
    res.json(await listAccountsPage(search, cursor ?? null, profileId))
  },
  'json',
)

commands.register(
  'ig-accounts.get.available-count',
  'GET',
  '/available-count',
  async (_req, res) => {
    res.json(await availableAccountCount())
  },
  'json',
)

commands.register(
  'ig-accounts.get.blacklist',
  'GET',
  '/blacklist',
  async (_req, res) => {
    res.json(await listBlacklistedProxies())
  },
  'json',
)

commands.register(
  'ig-accounts.get.warmup',
  'GET',
  '/warmup',
  async (_req, res) => {
    res.json(await listModelWarmup())
  },
  'json',
)

commands.register(
  'ig-accounts.post.warmup_profileId_reconcile',
  'POST',
  '/warmup/:profileId/reconcile',
  async (req, res) => {
    const resolution = req.body?.resolution
    if (resolution !== 'completed' && resolution !== 'failed')
      throw new ValidationError('Choose completed or failed')
    try {
      await reconcileModelWarmup(req.params.profileId, resolution)
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : 'Could not reconcile setup action',
      )
    }
    res.json({ ok: true })
  },
  'json',
)

commands.register(
  'ig-accounts.get.credentials_id',
  'GET',
  '/credentials/:id',
  async (req, res) => {
    try {
      const account = await accountById(req.params.id)
      if (!account) throw new ValidationError('Credential not found')
      res.json({
        id: account.id,
        username: account.username,
        password: account.password,
        authenticatorKey: account.authenticatorKey,
        status: account.status,
        profileId: account.profileId,
        error: account.error,
        createdAt: account.createdAt,
        retryAfter: account.retryAfter,
        browserLoggedInAt: account.browserLoggedInAt,
        reconnectRequired: account.reconnectRequired,
      })
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Credential not found')
    }
  },
  'json',
)

commands.register(
  'ig-accounts.get.models_modelId_content',
  'GET',
  '/models/:modelId/content',
  async (req, res) => {
    if (!(await listsList()).some((row) => row.id === req.params.modelId))
      throw new ValidationError('Model not found')
    res.json(await listContent(req.params.modelId))
  },
  'json',
)

commands.register(
  'ig-accounts.get.models_modelId_content_kind_contentId_image',
  'GET',
  '/models/:modelId/content/:kind/:contentId/image',
  async (req, res) => {
    if (!(await listsList()).some((row) => row.id === req.params.modelId))
      throw new ValidationError('Model not found')
    const kind = req.params.kind
    if (kind !== 'posts' && kind !== 'avatars') throw new ValidationError('Choose posts or avatars')
    const image = await contentImage(
      req.params.modelId,
      kind,
      req.params.contentId,
      req.query.thumbnail === '1',
    )
    if (!image) throw new ValidationError('Image not found')
    res
      .vary('Authorization')
      .set('Cache-Control', 'private, max-age=3600')
      .type(image.type)
      .send(image.bytes)
  },
  'json',
)

commands.register(
  'ig-accounts.post.models_modelId_content_kind',
  'POST',
  '/models/:modelId/content/:kind',
  async (req, res) => {
    if (!(await listsList()).some((row) => row.id === req.params.modelId))
      throw new ValidationError('Model not found')
    const kind = req.params.kind
    if (kind !== 'posts' && kind !== 'avatars') throw new ValidationError('Choose posts or avatars')
    const name = String(req.query.name ?? '')
    try {
      res.json(await addContent(req.params.modelId, kind as ContentKind, name, req.body as Buffer))
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Could not process image')
    }
  },
  'raw',
)

function contentKind(kind: unknown): ContentKind {
  if (kind !== 'posts' && kind !== 'avatars') throw new ValidationError('Choose posts or avatars')
  return kind
}

async function contentModel(modelId: string): Promise<void> {
  if (!(await listsList()).some((row) => row.id === modelId))
    throw new ValidationError('Model not found')
}

commands.register(
  'ig-accounts.post.models_modelId_content_kind_contentId_copies',
  'POST',
  '/models/:modelId/content/:kind/:contentId/copies',
  async (req, res) => {
    await contentModel(req.params.modelId)
    const kind = contentKind(req.params.kind)
    try {
      res.json(await generateCopies(req.params.modelId, kind, req.params.contentId))
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : 'Could not generate copies',
      )
    }
  },
  'json',
)

commands.register(
  'ig-accounts.get.models_modelId_content_kind_contentId_copies',
  'GET',
  '/models/:modelId/content/:kind/:contentId/copies',
  async (req, res) => {
    await contentModel(req.params.modelId)
    const kind = contentKind(req.params.kind)
    try {
      res.json(await listCopies(req.params.modelId, kind, req.params.contentId))
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Image not found')
    }
  },
  'json',
)

commands.register(
  'ig-accounts.get.models_modelId_content_kind_contentId_copies_variant_image',
  'GET',
  '/models/:modelId/content/:kind/:contentId/copies/:variant/image',
  async (req, res) => {
    await contentModel(req.params.modelId)
    const kind = contentKind(req.params.kind)
    const image = await copyImage(
      req.params.modelId,
      kind,
      req.params.contentId,
      req.params.variant,
      req.query.thumbnail === '1',
    )
    if (!image) throw new ValidationError('Image not found')
    res
      .vary('Authorization')
      .set('Cache-Control', 'private, max-age=3600')
      .type(image.type)
      .send(image.bytes)
  },
  'json',
)

commands.register(
  'ig-accounts.delete.models_modelId_content_kind_contentId',
  'DELETE',
  '/models/:modelId/content/:kind/:contentId',
  async (req, res) => {
    await contentModel(req.params.modelId)
    const kind = contentKind(req.params.kind)
    try {
      res.json(await removeContent(req.params.modelId, kind, req.params.contentId))
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Could not remove image')
    }
  },
  'json',
)

commands.register(
  'ig-accounts.post.import',
  'POST',
  '/import',
  async (req, res) => {
    if (typeof req.body?.text !== 'string') throw new ValidationError('Choose a TXT file')
    try {
      res.json(await importAccounts(req.body.text))
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid credentials')
    }
  },
  'json',
)

commands.register(
  'ig-accounts.post.create-batch',
  'POST',
  '/create-batch',
  async (req, res) => {
    const modelId = String(req.body?.modelId ?? '')
    const count = Number(req.body?.count)
    if (!Number.isSafeInteger(count) || count < 1 || count > 100)
      throw new ValidationError('Choose 1–100 profiles')
    const model = (await listsList()).find((row) => row.id === modelId)
    if (!model) throw new ValidationError('Choose a model')
    const accounts = await availableAccounts(count)
    if (accounts.length < count)
      throw new ValidationError(`Only ${accounts.length} unused credentials are available`)
    const created = await profilesCreateForModel(
      modelId,
      accounts.map((account) => ({ id: account.id, username: account.username })),
    )
    for (const row of created) queueProfileLogin(row.profileId)
    res.json({ created, count: created.length })
  },
  'json',
)

commands.register(
  'ig-accounts.post.profileId_connect',
  'POST',
  '/:profileId/connect',
  async (req, res) => {
    const profile = await profilesGetById(req.params.profileId)
    if (!profile || profile.status === 'deleting')
      throw new ValidationError('Choose a logged-in profile')
    let account =
      typeof req.body?.credentialId === 'string'
        ? await accountById(req.body.credentialId)
        : undefined
    if (!account && typeof req.body?.credentials === 'string') {
      if (!profile.igLoggedIn) throw new ValidationError('Choose a logged-in profile')
      const parsed = parseChatCredentials(req.body.credentials)
      if (!parsed) throw new ValidationError('Enter username:password:2FA key')
      await importAccounts(req.body.credentials)
      account = await accountByUsername(parsed.username)
    }
    if (!account || (account.profileId && account.profileId !== profile.id))
      throw new ValidationError('Choose an available credential')
    if (account.status === 'connected' && account.profileId === profile.id) {
      try {
        await reconnectAccount(account.id)
      } catch (error) {
        if (error instanceof InstagramError && error.status === 429) {
          res.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)))
          throw new AppError(error.message, 429, 'RATE_LIMITED')
        }
        throw new ValidationError(error instanceof Error ? error.message : 'Reconnect failed')
      }
      res.json({ ok: true })
      return
    }
    if (!profile.igLoggedIn) throw new ValidationError('Choose a logged-in profile')
    await assignAccount(account.id, profile.id)
    queueProfileLogin(profile.id)
    res.status(202).json({ queued: true, username: account.username })
  },
  'json',
)

export default commands
