import { Router } from 'express'
import { collectMonitoringSnapshot } from './shared.js'
import { asyncHandler } from '../shared/asyncHandler.js'

const router = Router()

router.get('/', asyncHandler(async (_req, res) => {
  const snapshot = await collectMonitoringSnapshot()
  res.json(snapshot)
}))

export default router
