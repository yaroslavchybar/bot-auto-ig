import path from 'path'
import fs from 'fs'
import { scrapeWorkers } from '../shared/store.js'
import { broadcast } from '../websocket.js'
import { automationMutex } from '../shared/mutex.js'
import {
  scrapeJobsFinish,
  scrapeJobsGetById,
  scrapeJobsStart,
} from '../shared/convexClient.js'
import logger from '../shared/logger.js'
import {
  spawnBun,
  killProcess,
  getPid,
  waitForExit,
} from '../shared/ProcessService.js'
import { NotFoundError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const SCRAPE_RUNNER = fs.existsSync(path.join(PROJECT_ROOT, 'server', 'scrapeJobs', 'runner.ts'))
  ? path.join(PROJECT_ROOT, 'server', 'scrapeJobs', 'runner.ts')
  : path.join(PROJECT_ROOT, 'server', 'dist', 'scrapeJobs', 'runner.js')

export { getPid, waitForExit }

export function getScrapeJobStatus(jobId?: string) {
  if (jobId) {
    const worker = scrapeWorkers.get(jobId)
    return {
      jobId,
      status: worker?.status ?? 'idle',
      running: Boolean(worker),
      startedAt: worker?.startedAt ?? null,
    }
  }
  return {
    running: scrapeWorkers.size > 0,
    runningCount: scrapeWorkers.size,
    jobs: Array.from(scrapeWorkers.entries()).map(([id, w]) => ({
      jobId: id,
      status: w.status,
      startedAt: w.startedAt,
    })),
  }
}

export interface RunScrapeJobInput {
  jobId: string
}

export async function runScrapeJob(input: RunScrapeJobInput, spawn = spawnBun): Promise<void> {
  const { jobId } = input
  const job = await scrapeJobsGetById(jobId)
  if (!job) throw new NotFoundError('Scrape job not found')

  const started = await scrapeJobsStart(jobId)
  if (!started) throw new NotFoundError('Scrape job not found')

  broadcast({ type: 'log', message: `Starting scrape job: ${started.name}`, level: 'info', source: 'server' })

  let proc: ReturnType<typeof spawn>
  try {
    proc = spawn({ args: [SCRAPE_RUNNER] })
  } catch (error) {
    await scrapeJobsFinish(
      jobId,
      'failed',
      error instanceof Error ? error.message : String(error),
    ).catch(() => undefined)
    throw error
  }
  scrapeWorkers.set(jobId, { process: proc, status: 'running', startedAt: Date.now() })

  let spawnError: Error | undefined
  // If the runner exits before reading the payload, stdin emits EPIPE.
  // Swallow it here; the close handler below marks the job failed.
  proc.stdin?.on('error', (err: Error) => {
    spawnError ??= err
  })
  proc.stdin?.write(JSON.stringify({ jobId }))
  proc.stdin?.end()

  proc.stdout?.on('data', (data: Buffer) => {
    for (const line of String(data).split('\n')) {
      const message = line.trim()
      if (!message) continue
      logger.info({ jobId }, message)
      broadcast({ type: 'log', message, level: 'info', source: 'typescript' })
    }
  })
  proc.stderr?.on('data', (data: Buffer) => {
    const message = String(data).trim()
    if (!message) return
    logger.error({ jobId }, message)
    broadcast({ type: 'log', message, level: 'error', source: 'typescript' })
  })

  proc.on('error', (err: Error) => {    spawnError = err
  })
  proc.on('close', async (code: number | null) => {
    if (scrapeWorkers.get(jobId)?.process !== proc) return
    scrapeWorkers.delete(jobId)
    try {
      const current = await scrapeJobsGetById(jobId)
      if (current?.status === 'running') {
        const stopRequested = Boolean((proc as any).__stopRequested)
        await scrapeJobsFinish(
          jobId,
          stopRequested ? 'cancelled' : 'failed',
          spawnError?.message ?? `Scrape process exited with code ${code}`,
        )
      }
    } catch { /* noop */ }
    broadcast({ type: 'log', message: `Scrape job finished with code ${code}`, level: code === 0 ? 'success' : 'warn', source: 'server' })
  })
}

export async function stopScrapeJobs(jobId?: string): Promise<string[]> {
  const idsToStop = jobId ? [jobId] : Array.from(scrapeWorkers.keys())
  const stopped: string[] = []
  for (const id of idsToStop) {
    const worker = scrapeWorkers.get(id)
    if (!worker) continue
    scrapeWorkers.set(id, { ...worker, status: 'stopping' })
    ;(worker.process as any).__stopRequested = true
    broadcast({ type: 'log', message: 'Stopping scrape job...', level: 'warn', source: 'server' })
    await killProcess(worker.process)
    stopped.push(id)
  }
  return stopped
}

export { automationMutex, scrapeWorkers }
