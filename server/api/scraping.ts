import { Router } from 'express'
import { profilesGetById, profilesList } from '../data/convex.js'

const router = Router()

const SCRAPER_URL = process.env.SCRAPER_URL || 'http://scraper:3003'

type EligibleProfile = { id: string; name: string; sessionId: string }

async function getEligibleProfiles(): Promise<EligibleProfile[]> {
  const all = await profilesList()
  const eligible = (all || [])
    .filter((p: any) => Boolean(p) && p.automation === false && typeof p.session_id === 'string' && p.session_id.trim())
    .map((p: any) => ({
      id: String(p.profile_id),
      name: String(p.name),
      sessionId: String(p.session_id || '').trim(),
    }))
    .filter((p: any) => p.id && p.name && p.sessionId)
  return eligible
}

router.get('/eligible-profiles', async (_req, res) => {
  try {
    const profiles = await getEligibleProfiles()
    res.json({ profiles: profiles.map((p) => ({ id: p.id, name: p.name })) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/followers', async (req, res) => {
  try {
    const { profileId, targetUsername, targetUsernames, limit, limitPerProfile, distribution } = req.body || {}

    class HttpError extends Error {
      status: number
      constructor(status: number, message: string) {
        super(message)
        this.status = status
        this.name = 'HttpError'
      }
    }

    const cleanTargets = (raw: unknown): string[] => {
      if (!raw) return []
      if (Array.isArray(raw)) {
        return raw
          .map((v) => String(v || '').trim().replace(/^@+/, ''))
          .filter(Boolean)
      }
      const text = String(raw || '').trim()
      if (!text) return []
      return text
        .split(/\r?\n/)
        .flatMap((line) => line.split(','))
        .map((v) => String(v || '').trim().replace(/^@+/, ''))
        .filter(Boolean)
    }

    const targets = cleanTargets(targetUsernames ?? targetUsername)
    if (targets.length === 0) {
      return res.status(400).json({ error: 'targetUsername is required' })
    }

    const lim = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 200
    const safeLimit = Math.max(1, Math.min(5000, lim))

    let cleanedProfileId = String(profileId || '').trim()
    const dist = String(distribution || '').trim().toLowerCase()

    const scrapeOne = async (cleanedTarget: string) => {
      if (!cleanedTarget) throw new HttpError(400, 'targetUsername is required')

      if (!cleanedProfileId) {
        if (dist !== 'auto') {
          throw new HttpError(400, 'profileId is required (or use distribution="auto")')
        }
        const eligible = await getEligibleProfiles()
        if (eligible.length === 0) {
          throw new HttpError(400, 'No eligible profiles (automation=false and sessionId set)')
        }

        const perProfileLim = Number.isFinite(Number(limitPerProfile)) ? Math.floor(Number(limitPerProfile)) : null
        const safePerProfile = perProfileLim ? Math.max(1, Math.min(5000, perProfileLim)) : null
        const chunkSize = safePerProfile ?? Math.ceil(safeLimit / eligible.length)
        const tasks = eligible
          .map((p, idx) => {
            const start = idx * chunkSize
            const remaining = safeLimit - start
            const taskLimit = Math.max(0, Math.min(chunkSize, remaining))
            return { profile: p, limit: taskLimit }
          })
          .filter((t) => t.limit > 0)

        const perProfile = await Promise.all(
          tasks.map(async (t) => {
            const resp = await fetch(`${SCRAPER_URL}/scrape/followers`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                auth_username: t.profile.name,
                session_id: t.profile.sessionId,
                target_username: cleanedTarget,
                limit: t.limit,
              }),
            })

            const text = await resp.text()
            let payload: any = null
            try {
              payload = text ? JSON.parse(text) : null
            } catch {
              payload = null
            }

            if (!resp.ok) {
              const message =
                (payload && (payload.detail || payload.error)) ||
                text ||
                `Scraper error (${resp.status})`

              return {
                ok: false as const,
                status: resp.status,
                usedProfile: { id: t.profile.id, name: t.profile.name },
                scraped: 0,
                error: String(message),
              }
            }

            const users = payload?.users
            const scraped = typeof payload?.scraped === 'number' ? payload.scraped : Array.isArray(users) ? users.length : 0

            return {
              ok: true as const,
              status: resp.status,
              usedProfile: { id: t.profile.id, name: t.profile.name },
              scraped,
              users: Array.isArray(users) ? users : [],
            }
          })
        )

        const users = perProfile.flatMap((r: any) => (r && r.ok && Array.isArray(r.users) ? r.users : []))
        const totalScraped = perProfile.reduce((sum: number, r: any) => sum + (typeof r?.scraped === 'number' ? r.scraped : 0), 0)
        const failures = perProfile.filter((r: any) => !r?.ok)

        return {
          distribution: 'auto',
          targetUsername: cleanedTarget,
          limit: safeLimit,
          eligibleCount: eligible.length,
          chunkSize,
          totalScraped,
          users,
          perProfile: perProfile.map((r: any) => {
            if (r?.ok) {
              return { ok: true, status: r.status, usedProfile: r.usedProfile, scraped: r.scraped }
            }
            return { ok: false, status: r?.status ?? 0, usedProfile: r?.usedProfile, scraped: 0, error: r?.error ?? 'Unknown error' }
          }),
          ...(failures.length > 0 ? { partial: true, failures: failures.length } : {}),
        }
      }

      const profile = await profilesGetById(cleanedProfileId)
      if (!profile) {
        throw new HttpError(404, 'Profile not found')
      }
      if (profile.automation === true) {
        throw new HttpError(400, 'Profile automation must be false')
      }
      const sessionId = String(profile.session_id || '').trim()
      if (!sessionId) {
        throw new HttpError(400, 'Profile sessionId is missing')
      }

      const resp = await fetch(`${SCRAPER_URL}/scrape/followers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          auth_username: profile.name,
          session_id: sessionId,
          target_username: cleanedTarget,
          limit: safeLimit,
        }),
      })

      const text = await resp.text()
      let payload: any = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = null
      }

      if (!resp.ok) {
        const message =
          (payload && (payload.detail || payload.error)) ||
          text ||
          `Scraper error (${resp.status})`
        throw new HttpError(resp.status, String(message))
      }

      return {
        ...(payload ?? {}),
        usedProfile: { id: cleanedProfileId, name: profile.name },
      }
    }

    if (targets.length === 1) {
      const single = await scrapeOne(targets[0]!)
      return res.json(single)
    }

    const perTarget: any[] = []
    for (const t of targets) {
      try {
        const payload = await scrapeOne(t)
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

    return res.json({
      batch: true,
      targets,
      limit: safeLimit,
      ...(dist === 'auto' ? { distribution: 'auto' } : {}),
      ...(Number.isFinite(Number(limitPerProfile)) ? { limitPerProfile: Math.max(1, Math.min(5000, Math.floor(Number(limitPerProfile)))) } : {}),
      totalScraped,
      users,
      perTarget,
      ...(failures.length > 0 ? { partial: true, failures: failures.length } : {}),
    })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number((error as any).status) : 500
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(Number.isFinite(status) ? status : 500).json({ error: message })
  }
})

export default router
