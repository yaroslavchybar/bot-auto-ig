import { Router } from 'express'
import { profileManager } from './data.js'
import {
  profilesListAssigned,
  profilesListUnassigned,
  profilesBulkSetListId,
  profilesBulkAddToList,
  profilesBulkRemoveFromList,
  profilesSyncStatus,
  profilesSetLoginTrue,
} from '../shared/convexClient.js'
import { profileProcesses } from '../shared/store.js'
import {
  normalizeProfileInput,
  generateFingerprint,
  startProfileBrowser,
  stopProfileBrowser,
} from './service.js'
import { asyncHandler } from '../shared/asyncHandler.js'
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../shared/errors.js'

const router = Router()

// Generate a new fingerprint using BrowserForge
router.post('/generate-fingerprint', asyncHandler(async (req, res) => {
  const { os = 'windows' } = req.body || {}
  const fingerprint = await generateFingerprint(os)
  res.json({ success: true, fingerprint })
}))

// Get all profiles
router.get('/', asyncHandler(async (_req, res) => {
  await profileManager.reconcileRuntimeStatuses(profileProcesses.keys())
  const profiles = await profileManager.getProfiles()
  res.json(profiles)
}))

router.get('/by-id', asyncHandler(async (req, res) => {
  const profileId = String(req.query.profileId || req.query.profile_id || '').trim()
  if (!profileId) {
    throw new ValidationError('profileId is required')
  }
  const profile = await profileManager.getProfileById(profileId)
  if (!profile) {
    throw new NotFoundError('Profile not found')
  }
  res.json(profile)
}))

// Create a profile
router.post('/', asyncHandler(async (req, res) => {
  const profile = parseProfileInput(req.body)
  if (!profile.name) {
    throw new ValidationError('name is required')
  }
  const success = await profileManager.createProfile(profile)
  if (!success) {
    throw new Error('Failed to create profile')
  }
  res.json({ success: true })
}))

// Update a profile
router.put('/:name', asyncHandler(async (req, res) => {
  const oldName = req.params.name
  const profile = parseProfileInput(req.body)
  if (!profile.name) {
    throw new ValidationError('name is required')
  }
  const success = await profileManager.updateProfile(oldName, profile)
  if (!success) {
    throw new Error('Failed to update profile')
  }
  res.json({ success: true })
}))

// Delete a profile
router.delete('/:name', asyncHandler(async (req, res) => {
  const name = req.params.name
  const success = await profileManager.deleteProfile(name)
  if (!success) {
    throw new Error('Failed to delete profile')
  }
  res.json({ success: true })
}))

// Start profile browser (manual browser control)
router.post('/:name/start', asyncHandler(async (req, res) => {
  const { name } = req.params
  if (profileProcesses.has(name)) {
    throw new ConflictError('Profile browser already running')
  }
  await startProfileBrowser(name)
  res.json({ success: true, message: `Browser started for ${name}` })
}))

// Stop profile browser
router.post('/:name/stop', asyncHandler(async (req, res) => {
  const { name } = req.params
  await stopProfileBrowser(name)
  res.json({ success: true, message: `Browser stopped for ${name}` })
}))

router.post('/reconcile-runtime', asyncHandler(async (_req, res) => {
  const result = await profileManager.reconcileRuntimeStatuses(profileProcesses.keys())
  res.json({ success: true, ...result })
}))

router.post('/sync-status', asyncHandler(async (req, res) => {
  const { name, status, using } = req.body || {}
  if (!name || !status) {
    throw new ValidationError('name and status are required')
  }
  await profilesSyncStatus(String(name), String(status), Boolean(using))
  res.json({ success: true })
}))

router.post('/set-login-true', asyncHandler(async (req, res) => {
  const { name } = req.body || {}
  if (!name) {
    throw new ValidationError('name is required')
  }
  await profilesSetLoginTrue(String(name))
  res.json({ success: true })
}))

router.get('/assigned', asyncHandler(async (req, res) => {
  const listId = String(req.query.list_id || '').trim()
  if (!listId) {
    throw new ValidationError('list_id is required')
  }
  const rows = await profilesListAssigned(listId)
  res.json(rows || [])
}))

router.get('/unassigned', asyncHandler(async (_req, res) => {
  const rows = await profilesListUnassigned()
  res.json(rows || [])
}))

router.post('/bulk-set-list-id', asyncHandler(async (req, res) => {
  const { profileIds, listId } = req.body || {}
  if (!Array.isArray(profileIds)) {
    throw new ValidationError('profileIds must be an array')
  }
  await profilesBulkSetListId(profileIds, listId ?? null)
  res.json({ success: true })
}))

router.post('/bulk-add-to-list', asyncHandler(async (req, res) => {
  const { profileIds, listId } = req.body || {}
  if (!Array.isArray(profileIds)) {
    throw new ValidationError('profileIds must be an array')
  }
  if (!listId) {
    throw new ValidationError('listId is required')
  }
  await profilesBulkAddToList(profileIds, String(listId))
  res.json({ success: true })
}))

router.post('/bulk-remove-from-list', asyncHandler(async (req, res) => {
  const { profileIds, listId } = req.body || {}
  if (!Array.isArray(profileIds)) {
    throw new ValidationError('profileIds must be an array')
  }
  if (!listId) {
    throw new ValidationError('listId is required')
  }
  await profilesBulkRemoveFromList(profileIds, String(listId))
  res.json({ success: true })
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse and normalize profile input; throws ValidationError on bad JSON. */
function parseProfileInput(body: unknown): any {
  try {
    return normalizeProfileInput(((body || {}) as Record<string, unknown>))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid cookies JSON'
    throw new ValidationError(message)
  }
}

export default router
