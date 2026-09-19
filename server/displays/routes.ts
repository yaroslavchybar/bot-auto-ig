import { Router } from 'express'
import { activeDisplays } from '../shared/store.js'
import clipboardRouter from './clipboard.js'
import { resolveDisplay } from './session.js'
import { getPreview } from './preview.js'
import { asyncHandler } from '../shared/asyncHandler.js'

const router = Router()

router.use(clipboardRouter)

router.get('/:vncPort/preview', asyncHandler(async (req, res) => {
    const image = await getPreview(resolveDisplay(req.params.vncPort))
    res.set('Cache-Control', 'no-store').json({ image })
}))

router.get('/', (_req, res) => {
    const sorted = Array.from(activeDisplays.values())
        .sort((a, b) => {
            if (a.automationId !== b.automationId) return a.automationId.localeCompare(b.automationId)
            return a.profileName.localeCompare(b.profileName)
        })
    res.json(sorted)
})

export default router
