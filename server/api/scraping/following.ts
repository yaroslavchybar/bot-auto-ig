// Following scraping endpoints

import { Router } from 'express'
import { HttpError } from './types.js'
import { cleanTargets, parseLimit, storeScrapedDataIfNeeded, handleError } from './helpers.js'
import { scrapeOne } from './scrape-core.js'

const router = Router()

router.post('/', async (req, res) => {
  try {
    const { profileId, targetUsername, targetUsernames, limit, distribution, taskId } = req.body || {}

    const targets = cleanTargets(targetUsernames ?? targetUsername)
    if (targets.length === 0) {
      return res.status(400).json({ error: 'targetUsername is required' })
    }

    const safeLimit = parseLimit(limit, 200, 1, 5000)
    const cleanedProfileId = String(profileId || '').trim()
    const dist = String(distribution || '').trim().toLowerCase()

    // Single target
    if (targets.length === 1) {
      const single = await scrapeOne({
        kind: 'following',
        cleanedTarget: targets[0]!,
        cleanedProfileId,
        distribution: dist,
        safeLimit,
      })
      const singleUsers = Array.isArray((single as any)?.users) ? (single as any).users : []
      
      const storageId = await storeScrapedDataIfNeeded(taskId, singleUsers, {
        targets: [targets[0]],
        kind: 'following',
        mode: dist === 'auto' ? 'auto' : 'manual',
        limit: safeLimit,
      })
      
      return res.json({
        ...single,
        ...(storageId ? { storageId } : {}),
      })
    }

    // Multiple targets - process sequentially
    const perTarget: any[] = []
    for (const t of targets) {
      try {
        const payload = await scrapeOne({
          kind: 'following',
          cleanedTarget: t,
          cleanedProfileId,
          distribution: dist,
          safeLimit,
        })
        const scraped =
          typeof (payload as any)?.scraped === 'number'
            ? (payload as any).scraped
            : typeof (payload as any)?.totalScraped === 'number'
              ? (payload as any).totalScraped
              : Array.isArray((payload as any)?.users)
                ? (payload as any).users.length
                : 0
        
        perTarget.push({ ok: true as const, targetUsername: t, scraped, payload })
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500
        const message = e instanceof Error ? e.message : String(e)
        perTarget.push({ ok: false as const, targetUsername: t, status, error: message })
      }
    }

    const users = perTarget.flatMap((r: any) => (r && r.ok && Array.isArray(r.payload?.users) ? r.payload.users : []))
    const totalScraped = perTarget.reduce((sum: number, r: any) => sum + (typeof r?.scraped === 'number' ? r.scraped : 0), 0)
    const failures = perTarget.filter((r: any) => !r?.ok)
    
    const storageId = await storeScrapedDataIfNeeded(taskId, users, {
      targets,
      kind: 'following',
      mode: dist === 'auto' ? 'auto' : 'manual',
      limit: safeLimit,
      perTarget: perTarget.map(r => ({
        targetUsername: r.targetUsername,
        ok: r.ok,
        scraped: r.scraped,
        ...(r.ok ? {} : { error: r.error })
      })),
      ...(dist === 'auto' ? { distribution: 'auto' } : {}),
    })

    return res.json({
      batch: true,
      targets,
      limit: safeLimit,
      ...(dist === 'auto' ? { distribution: 'auto' } : {}),
      totalScraped,
      users,
      perTarget,
      ...(failures.length > 0 ? { partial: true, failures: failures.length } : {}),
      ...(storageId ? { storageId } : {}),
    })
  } catch (error) {
    return handleError(error, res)
  }
})

export default router
