import { Router } from 'express'
import { collectMonitoringSnapshot } from './monitoring-shared.js'

const router = Router()

router.get('/', async (_req, res) => {
  try {
    const snapshot = await collectMonitoringSnapshot()
    res.json(snapshot)
  } catch (err) {
    console.error('[Monitoring] Error collecting metrics:', err)
    res.status(500).json({ error: 'Failed to collect system metrics' })
  }
})

export default router
