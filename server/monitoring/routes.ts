import { Router } from 'express'
import { collectMonitoringSnapshot } from './shared.js'
import logger from '../shared/logger.js'

const router = Router()

router.get('/', async (_req, res) => {
  try {
    const snapshot = await collectMonitoringSnapshot()
    res.json(snapshot)
  } catch (err) {
    logger.error({ err }, 'Error collecting monitoring metrics')
    res.status(500).json({ error: 'Failed to collect system metrics' })
  }
})

export default router
