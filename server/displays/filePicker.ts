import { Router } from 'express'
import { request } from 'node:http'
import { resolveDisplay } from './session.js'
import { automationWorkers } from '../shared/store.js'
import { pickerSocket } from '../browser/filePicker.js'
import { AppError } from '../shared/errors.js'

const router = Router()
// Stream to the browser worker without buffering on disk or in the API process.
router.all('/:vncPort/file-picker', (req, res, next) => {
  try {
    const session = resolveDisplay(req.params.vncPort)
    if (automationWorkers.has(session.automationId)) throw new AppError('Take control before uploading', 409, 'AGENT_ACTIVE')
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) { res.sendStatus(405); return }
    const upstream = request({
      socketPath: pickerSocket(session.vncPort),
      path: `/${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`,
      method: req.method,
      headers: { 'Content-Type': 'application/octet-stream' },
    }, response => {
      res.status(response.statusCode || 502).set('Content-Type', 'application/json').set('Cache-Control', 'no-store')
      response.pipe(res)
    })
    upstream.setTimeout(120_000, () => upstream.destroy(new Error('Upload timed out')))
    upstream.on('error', () => { if (!res.headersSent && !res.destroyed) res.status(503).json({ error: 'Browser file picker unavailable' }) })
    req.on('aborted', () => upstream.destroy())
    req.on('end', () => {
      try {
        if (resolveDisplay(session.vncPort) !== session || automationWorkers.has(session.automationId)) upstream.destroy()
      } catch { upstream.destroy() }
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  } catch (error) { next(error) }
})
export default router
