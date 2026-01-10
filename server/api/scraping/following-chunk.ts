// Following chunked scraping endpoint

import { Router } from 'express'
import { handleChunkRequest } from './chunk-core.js'

const router = Router()

router.post('/', async (req, res) => {
  return handleChunkRequest('following', req.body, res)
})

export default router
