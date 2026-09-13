import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright-core'
import type { DbProfileRow } from '../shared/convexClient.js'
import {
  profilesIncrementDailyScrapingUsed,
  instagramAccountsByJob,
  instagramAccountsInsertMany,
} from '../shared/convexClient.js'
import { shutdownSignal, sleep } from '../browser/lifecycle.js'
import {
    fetchMediaLikersPage,
    parsePostInput,
    type PostRef,
    type LikerUser,
} from './igWebApi.js'

export type User = {
  pk?: string | number
  id?: string
  username?: string
  full_name?: string
  is_verified?: boolean
  is_private?: boolean
}
export type ScrapeFieldSelection = {
  fullName: boolean
  isVerified: boolean
  isPrivate: boolean
}
export type ScrapeSkipRules = {
  private: boolean
  verified: boolean
  noFullName: boolean
}
export type FilteredAccount = {
  userName: string
  fullName?: string
  isVerified?: boolean
  isPrivate?: boolean
}
const count = (value: unknown, fallback: number) =>
  Number.isFinite(Number(value))
    ? Math.max(0, Math.floor(Number(value)))
    : fallback

// Persist chunk size. Mirrors igscrape batchSize: fetching uses the full
// 100-user window, but Convex writes go out in small chunks.
const PERSIST_BATCH_SIZE = 25

const firstLine = (value: unknown) => String(value).split('\n')[0]

function fieldSelection(config: Record<string, unknown>): ScrapeFieldSelection {
  const fields = (config.fields ?? {}) as Partial<ScrapeFieldSelection>
  return {
    fullName: fields.fullName !== false,
    isVerified: fields.isVerified !== false,
    isPrivate: fields.isPrivate !== false,
  }
}

function skipRules(config: Record<string, unknown>): ScrapeSkipRules {
  const skip = (config.skip ?? {}) as Partial<ScrapeSkipRules>
  return {
    private: skip.private === true,
    verified: skip.verified === true,
    noFullName: skip.noFullName === true,
  }
}

// Filter raw liker users through the job skip rules, then project
// only the selected export fields. Filtering runs on raw data first so
// unchecked columns can still drive skip decisions.
export function applyScrapeFilters(
  users: User[],
  config: Record<string, unknown>,
): { kept: FilteredAccount[]; skipped: number } {
  const fields = fieldSelection(config)
  const skip = skipRules(config)
  const kept: FilteredAccount[] = []
  let skipped = 0
  for (const user of users) {
    const userName = String(user.username ?? '').trim()
    const fullName = String(user.full_name ?? '').trim()
    const isVerified = user.is_verified === true
    const isPrivate = user.is_private === true
    if (!userName) {
      skipped++
      continue
    }
    if (skip.private && isPrivate) {
      skipped++
      continue
    }
    if (skip.verified && isVerified) {
      skipped++
      continue
    }
    if (skip.noFullName && !fullName) {
      skipped++
      continue
    }
    kept.push({
      userName,
      fullName: fields.fullName && fullName ? fullName : undefined,
      isVerified: fields.isVerified ? isVerified : undefined,
      isPrivate: fields.isPrivate ? isPrivate : undefined,
    })
  }
  return { kept, skipped }
}

// Scrapes likers of the configured posts and inserts survivors straight
// into instagramAccounts. TS port of igscrape runRealScrape (server/scraper.go):
// fixed 100-user fetch pages with max_id cursors, 3 attempts per page,
// persist in chunks of 25, random pause between chunks and pages, resume by
// skipping already-saved rows. Runs in the authenticated browser page; no
// session cookies leave the browser.
//
// Two deliberate deviations from Go, both forced by this repo's shape:
// - Delays default to 3-10s (config.batchDelayMs) instead of 1.5-3.5s.
// - Hitting the profile daily quota throws and the runner continues the job
//   with the next profile, instead of ending the scrape with a limit note.
export async function scrapePostLikers(input: {
  page: Page
  profile: DbProfileRow
  jobId: string
  jobName: string
  config: Record<string, unknown>
  state: Record<string, any>
  onProgress: () => void | Promise<void>
}): Promise<void> {
  const {
    page,
    profile,
    jobId,
    config,
    state,
    onProgress,
  } = input
  if (state.completed) return
  const rawTargets = Array.isArray(config.targets)
    ? config.targets
    : String(config.targets || '').split(/[\s,]+/)
  const posts: PostRef[] = (state.posts ??= (() => {
    const seen = new Set<string>()
    const parsed: PostRef[] = []
    for (const raw of rawTargets) {
      const ref = parsePostInput(raw)
      if (!ref) throw new Error(`Invalid post link: ${String(raw).trim() || '(empty)'}`)
      if (seen.has(ref.mediaPk)) continue
      seen.add(ref.mediaPk)
      parsed.push(ref)
    }
    return parsed
  })())
  if (!posts.length) throw new Error('Scrape job has no posts')
  const cap = count(config.maxToScrape, 0)
  // Human-like pause between chunks and pages. Overridable in tests via
  // config; not exposed in the UI.
  const randDelayMs = (): number => {
    const range = Array.isArray(config.batchDelayMs) ? config.batchDelayMs : [3000, 10000]
    const min = Math.max(0, Math.floor(Number(range[0])) || 0)
    const max = Math.max(min, Math.floor(Number(range[1])) || min)
    return max <= min ? min : min + Math.floor(Math.random() * (max - min + 1))
  }
  const log = (message: string) => {
    process.stdout.write(`[scrape] job=${jobId} ${message}\n`)
  }
  state.scrapeRunId ||= randomUUID()
  const runId = String(state.scrapeRunId)
  // Totals accumulate across profiles sharing this run; the runner reports them.
  const totals: { scraped: number; deduped: number; chunksCompleted: number; targetsCompleted: number } =
    (state.totals ??= { scraped: 0, deduped: 0, chunksCompleted: 0, targetsCompleted: 0 })

  // Resume: load already-scraped usernames so retries skip saved rows and
  // keep paging instead of stopping at the first all-duplicate page.
  // Seen names live in state so profiles sharing the run share them.
  if (!state.seeded) {
    state.seeded = true
    state.seenUsernames ??= []
    const seeded = new Set<string>(state.seenUsernames as string[])
    const existing = await instagramAccountsByJob(jobId)
    for (const row of existing) {
      const name = String(row.userName || '').toLowerCase()
      if (name) seeded.add(name)
    }
    state.seenUsernames = [...seeded]
    if (seeded.size > 0)
      log(`Found ${seeded.size} already-scraped liker(s). Resuming...`)
  }
  const seen = new Set<string>(state.seenUsernames as string[])
  const syncSeen = () => {
    state.seenUsernames = [...seen]
  }

  if (cap <= 0)
    log('No target limit set: scraping until Instagram ends. This can be slow.')

  let postIndex = Math.min(count(state.postIndex, 0), posts.length)
  while (postIndex < posts.length) {
    shutdownSignal.throwIfAborted()
    const post = posts[postIndex]
    log(`Target post: ${post.postUrl} (Media ID: ${post.mediaPk})`)
    await page.goto(post.postUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    await sleep(count(config.openDelaySeconds, 2) * 1000)

    // "Max Per Post" cap: per-post inserted counts persist in state so
    // resumes and profile handoffs sharing the run cannot exceed it.
    const postInserted: Record<string, number> = (state.postInserted ??= {})
    let insertedThisPost = Math.max(0, Math.floor(Number(postInserted[post.mediaPk]) || 0))
    let cursor: string | null = null
    let pageNum = 1
    const seenCursors = new Set<string>()
    const limitReached = () => cap > 0 && insertedThisPost >= cap

    while (!limitReached()) {
      shutdownSignal.throwIfAborted()
      const cursorShort = cursor ? ` (cursor: ${cursor.slice(0, 10)}...)` : ''
      log(`Fetching likers page ${pageNum}${cursorShort}...`)

      let users: LikerUser[] | undefined
      let pageCursor: string | null = null
      let pageHasNext = false
      const maxAttempts = Math.max(1, count(config.maxAttempts, 3))
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        shutdownSignal.throwIfAborted()
        try {
          const result = await fetchMediaLikersPage(page, post.mediaPk, cursor)
          users = result.users
          pageCursor = result.cursor
          pageHasNext = result.cursor != null
          break
        } catch (error) {
          shutdownSignal.throwIfAborted()
          const message = String(error)
          if (/login required|Post not found|session expired|HTTP 302/.test(message))
            throw error
          if (attempt >= maxAttempts) break
          log(`Page ${pageNum} attempt ${attempt}/${maxAttempts} failed: ${firstLine(message)}`)
          // Backoff between page retries: 1.5s * attempt, same as Go.
          await sleep(attempt * 1500)
        }
      }
      if (!users)
        throw new Error(
          `Failed to fetch likers page ${pageNum} after ${maxAttempts} attempts; ` +
          `${totals.scraped} saved likers retained. Resume to try again.`,
        )
      if (users.length === 0) {
        if (pageHasNext)
          throw new Error('Instagram returned an empty page with more results pending. Resume to try again.')
        log('No more likers returned by Instagram.')
        break
      }

      // Idempotent quota charge tied to this page fetch. A crash after the
      // charge but before persisting retries the same page with the same
      // key, and the server applies it at most once. The charge is clamped
      // to the profile's remaining daily quota (the server only adds).
      const remaining =
        profile.dailyScrapingLimit == null
          ? Infinity
          : Math.max(
              0,
              profile.dailyScrapingLimit -
                (profile.dailyScrapingUsed || 0),
            )
      if (remaining === 0)
        throw new Error('Profile daily scraping limit reached')
      const charge = Math.min(users.length, remaining)
      const quotaCommitKey = `${jobId}:${runId}:post:${postIndex}:page:${pageNum}`
      const quotaApplied = await profilesIncrementDailyScrapingUsed(
        profile.name,
        charge,
        quotaCommitKey,
      )
      if (quotaApplied)
        profile.dailyScrapingUsed =
          (profile.dailyScrapingUsed || 0) + charge

      const { kept, skipped } = applyScrapeFilters(users as User[], config)
      // Page-scoped dedupe only; global seen updates happen after each
      // successful insert below, so a failed insert retries its rows on
      // resume instead of skipping them as already saved.
      const fresh: FilteredAccount[] = []
      const pageSeen = new Set<string>()
      let alreadySaved = 0
      for (const account of kept) {
        const key = account.userName.toLowerCase()
        if (pageSeen.has(key) || seen.has(key)) {
          alreadySaved++
          continue
        }
        pageSeen.add(key)
        fresh.push(account)
      }
      totals.deduped += skipped + alreadySaved

      let toAdd = fresh
      if (cap > 0) {
        const need = Math.max(0, cap - insertedThisPost)
        if (need < toAdd.length) toAdd = toAdd.slice(0, need)
      }

      if (toAdd.length > 0) {
        const chunks: FilteredAccount[][] = []
        for (let index = 0; index < toAdd.length; index += PERSIST_BATCH_SIZE)
          chunks.push(toAdd.slice(index, index + PERSIST_BATCH_SIZE))
        const limitSuffix = cap > 0 ? `/${cap}` : ''
        for (let chunk = 0; chunk < chunks.length; chunk++) {
          shutdownSignal.throwIfAborted()
          // Filter through the job skip rules, then insert survivors straight
          // into instagramAccounts. Existing rows are never overwritten.
          const inserted = await instagramAccountsInsertMany(
            chunks[chunk].map((account) => ({ ...account, sourceJobId: jobId })),
          )
          // Mark seen only after the insert resolves; cap-trimmed rows were
          // never attempted and stay retryable.
          for (const account of chunks[chunk]) seen.add(account.userName.toLowerCase())
          syncSeen()
          totals.scraped += inserted.inserted
          totals.deduped += inserted.existed + inserted.skipped
          insertedThisPost += inserted.inserted
          postInserted[post.mediaPk] = insertedThisPost
          totals.chunksCompleted++
          const batchLabel =
            chunks.length > 1 ? `Page ${pageNum} batch ${chunk + 1}/${chunks.length}` : `Page ${pageNum}`
          log(`${batchLabel}: saved ${inserted.inserted} new likers (total: ${totals.scraped}${limitSuffix})`)
          await onProgress()
          if (limitReached()) break
          if (chunk < chunks.length - 1) {
            const delay = randDelayMs()
            log(`Waiting ${(delay / 1000).toFixed(2)}s before next batch...`)
            await sleep(delay)
          }
        }
      } else {
        log(
          `Page ${pageNum}: received ${users.length} likers ` +
          `(${skipped} filtered, ${alreadySaved} already saved).`,
        )
      }

      if (!limitReached() && pageCursor != null) {
        if (seenCursors.has(pageCursor))
          throw new Error('Instagram returned a repeated pagination cursor. Saved results retained; resume to try again.')
        seenCursors.add(pageCursor)
      }
      cursor = pageCursor
      const hasNextPage = pageHasNext && cursor != null
      pageNum++

      if (limitReached()) {
        log(`Reached target limit of ${cap} accounts!`)
        break
      }
      if (!hasNextPage) {
        log('Reached end of available likers list.')
        break
      }
      const delay = randDelayMs()
      log(`Waiting ${(delay / 1000).toFixed(2)}s before next page...`)
      await sleep(delay)
    }

    // Save the next post before continuing so a restart cannot redo a post.
    postIndex++
    state.postIndex = postIndex
    totals.targetsCompleted++
    await onProgress()
  }
  state.completed = true
  log(`Successfully scraped ${totals.scraped} live likers!`)
  await onProgress()
}
