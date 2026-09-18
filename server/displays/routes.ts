import { Router } from 'express'
import { activeDisplays } from '../shared/store.js'
import clipboardRouter from './clipboard.js'

const router = Router()

router.use(clipboardRouter)

router.get('/', (_req, res) => {
    const sorted = Array.from(activeDisplays.values())
        .sort((a, b) => {
            if (a.automationId !== b.automationId) return a.automationId.localeCompare(b.automationId)
            return a.profileName.localeCompare(b.profileName)
        })
    res.json(sorted)
})

export default router
