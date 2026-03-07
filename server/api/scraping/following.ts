// Following scraping endpoints

import { Router } from 'express'
import { HttpError } from './types.js'
import { cleanTargets, storeScrapedDataIfNeeded, handleError } from './helpers.js'
import { emitScraperLog } from './logging.js'
import { scrapeOne } from './scrape-core.js'

const router = Router()

router.post('/', async (req, res) => {
  try {
    const { targetUsername, targetUsernames, taskId } = req.body || {}

    const targets = cleanTargets(targetUsernames ?? targetUsername)
    if (targets.length === 0) {
      return res.status(400).json({ error: 'targetUsername is required' })
    }

    // Single target
    if (targets.length === 1) {
      const single = await scrapeOne({
        kind: 'following',
        cleanedTarget: targets[0]!,
      })
      const singleUsers = Array.isArray((single as any)?.users) ? (single as any).users : []
      
      const storageId = await storeScrapedDataIfNeeded(taskId, singleUsers, {
        targets: [targets[0]],
        kind: 'following',
        autoOnly: true,
      })
      
      return res.json({
        ...single,
        ...(storageId ? { storageId } : {}),
      })
    }

    // Multiple targets - process sequentially
    emitScraperLog(`Starting batch following scrape for ${targets.length} targets`)
    const perTarget: any[] = []
    for (const t of targets) {
      try {
        const payload = await scrapeOne({
          kind: 'following',
          cleanedTarget: t,
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
      autoOnly: true,
      perTarget: perTarget.map(r => ({
        targetUsername: r.targetUsername,
        ok: r.ok,
        scraped: r.scraped,
        ...(r.ok ? {} : { error: r.error })
      })),
    })

    emitScraperLog(
      `Finished batch following scrape for ${targets.length} targets: ${totalScraped} records collected${failures.length > 0 ? `, ${failures.length} failed` : ''}`,
      { level: failures.length > 0 ? 'warn' : 'success' }
    )

    return res.json({
      batch: true,
      targets,
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
