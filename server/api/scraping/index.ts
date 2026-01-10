// Main scraping router - combines all scraping endpoints

import { Router } from 'express'
import { getEligibleProfiles } from './helpers.js'
import followersRouter from './followers.js'
import followingRouter from './following.js'
import followersChunkRouter from './followers-chunk.js'
import followingChunkRouter from './following-chunk.js'

const router = Router()

// Eligible profiles endpoint
router.get('/eligible-profiles', async (_req, res) => {
  try {
    const profiles = await getEligibleProfiles()
    res.json({ profiles: profiles.map((p) => ({ id: p.id, name: p.name })) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Mount sub-routers
router.use('/followers', followersRouter)
router.use('/following', followingRouter)
router.use('/followers-chunk', followersChunkRouter)
router.use('/following-chunk', followingChunkRouter)

export default router
