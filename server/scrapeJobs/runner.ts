import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openCamoufoxSession } from '../browser/camoufox.js'
import { shouldStop, shutdownSignal } from '../browser/lifecycle.js'
import {
  profilesList,
  profilesSyncStatus,
  scrapeJobsFinish,
  scrapeJobsGetById,
  scrapeJobsUpdateStats,
  type DbProfileRow,
} from '../shared/convexClient.js'
import { profileEligible } from '../automation/graph.js'
import { scrapePostLikers } from '../automation/scrape.js'

function log(message: string, level = 'info'): void {
  process.stdout.write(`[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}\n`)
}

type JobState = Record<string, any>

function jobTotals(state: JobState) {
  const totals = state.totals ?? {}
  return {
    scraped: Math.max(0, Math.floor(Number(totals.scraped) || 0)),
    deduped: Math.max(0, Math.floor(Number(totals.deduped) || 0)),
    chunksCompleted: Math.max(0, Math.floor(Number(totals.chunksCompleted) || 0)),
    targetsCompleted: Math.max(0, Math.floor(Number(totals.targetsCompleted) || 0)),
  }
}

async function runWithProfile(
  profile: DbProfileRow,
  job: { _id: string; name: string; targets: string[]; config: Record<string, unknown> },
  state: JobState,
): Promise<void> {
  const session = await openCamoufoxSession(profile.name, { headless: true })
  try {
    await profilesSyncStatus(profile.name, 'running', true)
    try {
      await scrapePostLikers({
        page: session.page,
        profile: session.profile,
        jobId: job._id,
        jobName: job.name,
        config: { ...job.config, targets: job.targets },
        state,
        onProgress: async () => {
          await scrapeJobsUpdateStats(job._id, jobTotals(state)).catch(() => undefined)
        },
      })
    } finally {
      await profilesSyncStatus(profile.name, 'idle', false).catch(() => undefined)
    }
  } finally {
    await session.close().catch(() => undefined)
  }
}

export async function runScrapeJob(input: { jobId: string }): Promise<void> {
  const jobId = String(input.jobId || '').trim()
  if (!jobId) throw new Error('jobId is required')
  // The service owns the idle -> running transition before spawning.
  // The runner only reads the job; starting here would conflict with it.
  const job = await scrapeJobsGetById(jobId)
  if (!job) throw new Error('Scrape job not found')
  log(`Starting scrape job: ${job.name}`)
  const state: JobState = {}
  try {
    const profiles = (await profilesList()).filter((profile) =>
      profileEligible(profile, job.listIds ?? [], 0),
    )
    if (!profiles.length)
      throw new Error('No available logged-in profile in the selected lists')
    for (const profile of profiles) {
      shutdownSignal.throwIfAborted()
      if (state.completed) break
      try {
        await runWithProfile(profile, job as any, state)
      } catch (error) {
        if (/daily scraping limit reached/.test(String(error))) continue
        throw error
      }
    }
    if (!state.completed) throw new Error('Scrape job did not complete')
    const stats = jobTotals(state)
    await scrapeJobsFinish(jobId, 'completed', undefined, stats)
    log(`Scrape job completed: ${job.name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`${job.name}: ${message}`, 'error')
    if (shouldStop()) {
      await scrapeJobsFinish(jobId, 'cancelled', message).catch(() => undefined)
    } else {
      await scrapeJobsFinish(jobId, 'failed', message).catch(() => undefined)
    }
    throw error
  }
}

async function main(): Promise<void> {
  const input = JSON.parse(
    await new Promise<string>((resolve, reject) => {
      let value = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (chunk) => {
        value += chunk
      })
      process.stdin.on('end', () => resolve(value))
      process.stdin.on('error', reject)
    }),
  ) as { jobId?: string }
  if (!input.jobId) throw new Error('jobId is required')
  await runScrapeJob({ jobId: input.jobId })
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    log(message, 'error')
    process.exitCode = shouldStop() ? 0 : 1
  })
