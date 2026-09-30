import { Commands } from '../worker/commands.js'
import { profileManager } from './data.js'
import { deleteProfile, updateProfile } from './maintenance.js'
import { profilesSyncStatus } from '../shared/convexClient.js'
import { getActiveRuntimeProfileNames, profileProcesses } from '../shared/store.js'
import { normalizeProfileInput, startProfileBrowser, stopProfileBrowser } from './service.js'
import { AppError, ValidationError, NotFoundError } from '../shared/errors.js'

const commands = new Commands()

// Get all profiles
commands.register(
  'profiles.get.list',
  'GET',
  '/',
  async (_req, res) => {
    const profiles = await profileManager.getProfiles()
    res.json(profiles)
  },
  'json',
)

commands.register(
  'profiles.get.by-id',
  'GET',
  '/by-id',
  async (req, res) => {
    const profileId = String(req.query.profileId || req.query.id || '').trim()
    if (!profileId) {
      throw new ValidationError('profileId is required')
    }
    const profile = await profileManager.getProfileById(profileId)
    if (!profile) {
      throw new NotFoundError('Profile not found')
    }
    res.json(profile)
  },
  'json',
)

// Create a profile
commands.register(
  'profiles.post.list',
  'POST',
  '/',
  async (req, res) => {
    const profile = parseProfileInput(req.body)
    if (!profile.name) {
      throw new ValidationError('name is required')
    }
    const success = await profileManager.createProfile(profile)
    if (!success) {
      throw new AppError('Failed to create profile', 500, 'INTERNAL_ERROR')
    }
    res.json({ success: true })
  },
  'json',
)

// Update a profile
commands.register(
  'profiles.put.name',
  'PUT',
  '/:name',
  async (req, res) => {
    const oldName = req.params.name
    const profile = parseProfileInput(req.body)
    if (!profile.name) {
      throw new ValidationError('name is required')
    }
    await updateProfile(oldName, profile)
    res.json({ success: true })
  },
  'json',
)

// Delete a profile
commands.register(
  'profiles.delete.name',
  'DELETE',
  '/:name',
  async (req, res) => {
    const name = req.params.name
    await deleteProfile(name)
    res.json({ success: true })
  },
  'json',
)

// Start profile browser (manual browser control)
commands.register(
  'profiles.post.name_start',
  'POST',
  '/:name/start',
  async (req, res) => {
    const { name } = req.params
    if (profileProcesses.has(name)) {
      throw new ValidationError('Profile browser already running')
    }
    await startProfileBrowser(name)
    res.json({ success: true, message: `Browser started for ${name}` })
  },
  'json',
)

// Stop profile browser
commands.register(
  'profiles.post.name_stop',
  'POST',
  '/:name/stop',
  async (req, res) => {
    const { name } = req.params
    await stopProfileBrowser(name)
    res.json({ success: true, message: `Browser stopped for ${name}` })
  },
  'json',
)

commands.register(
  'profiles.post.reconcile-runtime',
  'POST',
  '/reconcile-runtime',
  async (_req, res) => {
    const result = await profileManager.reconcileRuntimeStatuses(getActiveRuntimeProfileNames())
    res.json({ success: true, ...result })
  },
  'json',
)

commands.register(
  'profiles.post.sync-status',
  'POST',
  '/sync-status',
  async (req, res) => {
    const { name, status, using } = req.body || {}
    if (!name || !status) {
      throw new ValidationError('name and status are required')
    }
    await profilesSyncStatus(String(name), String(status), Boolean(using))
    res.json({ success: true })
  },
  'json',
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse and normalize profile input; throws ValidationError on bad JSON. */
function parseProfileInput(body: unknown): any {
  try {
    return normalizeProfileInput((body || {}) as Record<string, unknown>)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid cookies JSON'
    throw new ValidationError(message)
  }
}

export default commands
