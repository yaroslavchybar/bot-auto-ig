import { Router } from 'express'
import { activeDisplays } from '../shared/store.js'
import clipboardRouter from './clipboard.js'
import { resolveDisplay } from './session.js'
import { getPreview } from './preview.js'
import { asyncHandler } from '../shared/asyncHandler.js'

const router = Router()

router.use(clipboardRouter)

router.get('/:vncPort/preview', asyncHandler(async (req, res) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    res.once('close', abort)
    try {
        const image = await getPreview(resolveDisplay(req.params.vncPort), controller.signal)
        if (!controller.signal.aborted) res.set('Cache-Control', 'no-store').type('image/jpeg').send(image)
    } catch (error) {
        if (!controller.signal.aborted) throw error
    } finally {
        res.removeListener('close', abort)
    }
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
