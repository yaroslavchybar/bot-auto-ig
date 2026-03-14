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
} from '../data/convex.js'
import { profileProcesses } from '../store.js'
import {
  normalizeProfileInput,
  generateFingerprint,
  startProfileBrowser,
  stopProfileBrowser,
} from './service.js'
import { asyncHandler } from '../shared/asyncHandler.js'
import logger from '../shared/logger.js'

const router = Router()

// Generate a new fingerprint using BrowserForge
router.post('/generate-fingerprint', asyncHandler(async (req, res) => {
  const { os = 'windows' } = req.body || {}
  try {
    const fingerprint = await generateFingerprint(os)
    res.json({ success: true, fingerprint })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
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
    return res.status(400).json({ error: 'profileId is required' })
  }
  const profile = await profileManager.getProfileById(profileId)
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' })
  }
  res.json(profile)
}))

// Create a profile
router.post('/', asyncHandler(async (req, res) => {
  let profile
  try {
    profile = normalizeProfileInput((req.body || {}) as Record<string, unknown>)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid cookies JSON'
    return res.status(400).json({ error: message })
  }
  if (!profile.name) {
    return res.status(400).json({ error: 'name is required' })
  }
  const success = await profileManager.createProfile(profile)
  if (success) {
    res.json({ success: true })
  } else {
    res.status(500).json({ error: 'Failed to create profile' })
  }
}))

// Update a profile
router.put('/:name', asyncHandler(async (req, res) => {
  const oldName = req.params.name
  let profile
  try {
    profile = normalizeProfileInput((req.body || {}) as Record<string, unknown>)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid cookies JSON'
    return res.status(400).json({ error: message })
  }
  if (!profile.name) {
    return res.status(400).json({ error: 'name is required' })
  }
  const success = await profileManager.updateProfile(oldName, profile)
  if (success) {
    res.json({ success: true })
  } else {
    res.status(500).json({ error: 'Failed to update profile' })
  }
}))

// Delete a profile
router.delete('/:name', asyncHandler(async (req, res) => {
  const name = req.params.name
  const success = await profileManager.deleteProfile(name)
  if (success) {
    res.json({ success: true })
  } else {
    res.status(500).json({ error: 'Failed to delete profile' })
  }
}))

// Start profile browser (manual browser control)
router.post('/:name/start', asyncHandler(async (req, res) => {
  const { name } = req.params

  if (profileProcesses.has(name)) {
    return res.status(400).json({ error: 'Profile browser already running' })
  }

  try {
    await startProfileBrowser(name)
    res.json({ success: true, message: `Browser started for ${name}` })
  } catch (error: any) {
    const statusCode = error?.statusCode || 500
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(statusCode).json({ error: message })
  }
}))

// Stop profile browser
router.post('/:name/stop', asyncHandler(async (req, res) => {
  const { name } = req.params

  try {
    await stopProfileBrowser(name)
    res.json({ success: true, message: `Browser stopped for ${name}` })
  } catch (error: any) {
    const statusCode = error?.statusCode || 500
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(statusCode).json({ error: message })
  }
}))

router.post('/reconcile-runtime', asyncHandler(async (_req, res) => {
  const result = await profileManager.reconcileRuntimeStatuses(profileProcesses.keys())
  res.json({ success: true, ...result })
}))

router.post('/sync-status', asyncHandler(async (req, res) => {
  const { name, status, using } = req.body || {}
  if (!name || !status) {
    return res.status(400).json({ error: 'name and status are required' })
  }
  await profilesSyncStatus(String(name), String(status), Boolean(using))
  res.json({ success: true })
}))

router.post('/set-login-true', asyncHandler(async (req, res) => {
  const { name } = req.body || {}
  if (!name) {
    return res.status(400).json({ error: 'name is required' })
  }
  await profilesSetLoginTrue(String(name))
  res.json({ success: true })
}))

router.get('/assigned', asyncHandler(async (req, res) => {
  const listId = String(req.query.list_id || '').trim()
  if (!listId) {
    return res.status(400).json({ error: 'list_id is required' })
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
    return res.status(400).json({ error: 'profileIds must be an array' })
  }
  await profilesBulkSetListId(profileIds, listId ?? null)
  res.json({ success: true })
}))

router.post('/bulk-add-to-list', asyncHandler(async (req, res) => {
  const { profileIds, listId } = req.body || {}
  if (!Array.isArray(profileIds)) {
    return res.status(400).json({ error: 'profileIds must be an array' })
  }
  if (!listId) {
    return res.status(400).json({ error: 'listId is required' })
  }
  await profilesBulkAddToList(profileIds, String(listId))
  res.json({ success: true })
}))

router.post('/bulk-remove-from-list', asyncHandler(async (req, res) => {
  const { profileIds, listId } = req.body || {}
  if (!Array.isArray(profileIds)) {
    return res.status(400).json({ error: 'profileIds must be an array' })
  }
  if (!listId) {
    return res.status(400).json({ error: 'listId is required' })
  }
  await profilesBulkRemoveFromList(profileIds, String(listId))
  res.json({ success: true })
}))

export default router
