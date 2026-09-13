import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Page } from 'playwright-core'
import type { DbProfileRow } from '../shared/convexClient.js'
import {
  profilesIncrementDailyScrapingUsed,
  scrapingAccountsPending,
  scrapingAccountComplete,
  workflowArtifactUpsert,
} from '../shared/convexClient.js'
import { resolveProjectRoot } from '../shared/utils.js'
import { shutdownSignal, sleep } from '../browser/lifecycle.js'

type Kind = 'followers' | 'following'
export type User = {
  pk?: string | number
  id?: string
  username?: string
  full_name?: string
}
type Progress = {
  target: number
  cursor: string | null
  targetCount: number
  chunks: number
  scraped: number
  completed: boolean
}
const count = (value: unknown, fallback: number) =>
  Number.isFinite(Number(value))
    ? Math.max(0, Math.floor(Number(value)))
    : fallback

// Runs in the authenticated page; no session cookies leave the browser.
export async function fetchRelationshipPage(
  page: Page,
  username: string,
  kind: Kind,
  cursor: string | null,
  limit: number,
  target: { userId?: string; total?: number } = {},
) {
  const result = await page.evaluate(
    async ({ username, kind, cursor, limit, target }) => {
      const headers: Record<string, string> = {
        'x-ig-app-id': '936619743392459',
        'x-asbd-id': '129477',
        'x-requested-with': 'XMLHttpRequest',
      }
      const csrf = document.cookie
        .split('; ')
        .find((part) => part.startsWith('csrftoken='))
        ?.slice(10)
      if (csrf) headers['x-csrftoken'] = decodeURIComponent(csrf)
      const request = async (url: string) => {
        const response = await fetch(url, {
          headers,
          credentials: 'include',
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) throw new Error(`Instagram HTTP ${response.status}`)
        const body = await response.json()
        if (body.status === 'fail')
          throw new Error(String(body.message || 'Instagram request failed'))
        return body
      }
      if (!target.userId) {
        const metadata = await request(
          `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
        )
        const user = metadata.data?.user
        target = { userId: String(user?.id || user?.pk || ''), total:
          kind === 'followers' ? user?.edge_followed_by?.count : user?.edge_follow?.count }
      }
      const userId = target.userId
      if (!userId) throw new Error('Target profile not found')
      const params = new URLSearchParams({ count: String(limit) })
      if (cursor) params.set('max_id', cursor)
      const body = await request(
        `/api/v1/friendships/${encodeURIComponent(String(userId))}/${kind}/?${params}`,
      )
      const users = body.users ?? body.profiles
      if (!Array.isArray(users))
        throw new Error('Invalid relationship response')
      if (!cursor && users.length === 0 && Number(target.total) > 0)
        throw new Error(
          'Instagram returned an incomplete empty relationship list',
        )
      return {
        target,
        users: users as User[],
        cursor:
          body.next_max_id == null || body.big_list === false
            ? null
            : String(body.next_max_id) || null,
      }
    },
    { username, kind, cursor, limit, target },
  )
  Object.assign(target, result.target)
  return result
}

export async function scrapeRelationships(input: {
  page: Page
  profile: DbProfileRow
  workflowId: string
  workflowName: string
  nodeId: string
  config: Record<string, unknown>
  state: Record<string, any>
  onProgress: () => void | Promise<void>
  artifactRoot?: string
}): Promise<void> {
  const {
    page,
    profile,
    workflowId,
    workflowName,
    nodeId,
    config,
    state,
    onProgress,
  } = input
  if (state.completed) return
  const accounts: Array<{ id: string; user_name: string }> = (state.accounts ??=
    config.useAccountUsernames ? await scrapingAccountsPending() : [])
  const rawTargets = config.useAccountUsernames
    ? accounts.map((account) => account.user_name)
    : Array.isArray(config.targets)
      ? config.targets
      : String(config.targets || '').split(/[\n,]/)
  const targets: string[] = (state.targets ??= [
    ...new Set(
      rawTargets
        .map((value) => String(value).trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean),
    ),
  ])
  if (!targets.length) throw new Error('Scrape Relationships has no targets')
  if (targets.some((target) => !/^[a-z0-9._]+$/.test(target)))
    throw new Error('Invalid target username')
  const kinds: Kind[] =
    config.kind === 'both'
      ? ['followers', 'following']
      : [config.kind === 'following' ? 'following' : 'followers']
  state.scrapeRunId ||= randomUUID()
  const root =
    input.artifactRoot ??
    path.join(resolveProjectRoot(import.meta.url), 'data', 'uploads', 'scrapes')
  await fs.mkdir(root, { recursive: true })

  for (const kind of kinds) {
    const key = createHash('sha256')
      .update(
        JSON.stringify([workflowId, nodeId, state.scrapeRunId, kind, targets]),
      )
      .digest('hex')
    const relativePath = `scrapes/${key}.json`
    const filename = path.join(root, `${key}.json`)
    let progress: Progress = {
      target: 0,
      cursor: null,
      targetCount: 0,
      chunks: 0,
      scraped: 0,
      completed: false,
    }
    try {
      const checkpoint = JSON.parse(await fs.readFile(filename, 'utf8'))
      if (checkpoint.format !== 'ig-bot-chunks-v1') throw new Error('Unsupported scrape checkpoint; start a fresh workflow run')
      progress = checkpoint.progress
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const chunkRoot = `${filename}.chunks`
    await fs.mkdir(chunkRoot, { recursive: true })
    const seen = new Set<string>()
    for (let index = 0; index < progress.chunks; index++) {
      const users: User[] = JSON.parse(await fs.readFile(path.join(chunkRoot, `${index}.json`), 'utf8'))
      for (const user of users) seen.add(String(user.pk ?? user.id ?? user.username).toLowerCase())
    }
    const persist = async (status: string) => {
      const payload = {
        format: 'ig-bot-chunks-v1',
        workflowId,
        nodeId,
        kind,
        targets,
        count: progress.scraped,
        profileName: profile.name,
        storageKind: 'local',
        progress,
      }
      const temporary = `${filename}.tmp`
      await fs.writeFile(temporary, JSON.stringify(payload))
      await fs.rename(temporary, filename)
      await workflowArtifactUpsert({
        workflowId,
        workflowName,
        nodeId,
        kind,
        targets,
        sourceProfileName: profile.name,
        localArtifactPath: relativePath,
        status,
        stats: {
          scraped: progress.scraped,
          deduped: progress.scraped,
          chunksCompleted: progress.chunks,
          targetsCompleted: progress.target,
        },
      })
      await onProgress()
    }
    try {
      while (progress.target < targets.length) {
        shutdownSignal.throwIfAborted()
        const username = targets[progress.target]
        const targetMetadata: { userId?: string; total?: number } = {}
        await page.goto(`https://www.instagram.com/${username}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        })
        await sleep(count(config.openDelaySeconds, 2) * 1000)
        await page
          .locator(`a[href="/${username}/${kind}/"]`)
          .first()
          .click({ timeout: 15_000 })
        const cap = count(
          config[
            kind === 'followers'
              ? 'followersMaxToScrape'
              : 'followingMaxToScrape'
          ],
          0,
        )
        do {
          shutdownSignal.throwIfAborted()
          const remaining =
            profile.daily_scraping_limit == null
              ? Infinity
              : Math.max(
                  0,
                  profile.daily_scraping_limit -
                    (profile.daily_scraping_used || 0),
                )
          if (remaining === 0)
            throw new Error('Profile daily scraping limit reached')
          const limit = Math.min(
            200,
            Math.max(1, count(config.chunkLimit, 200)),
            remaining,
            cap ? cap - progress.targetCount : Infinity,
          )
          if (limit <= 0) break
          let result:
            | Awaited<ReturnType<typeof fetchRelationshipPage>>
            | undefined
          const backoff = String(
            config.retryBackoffSeconds || '30,120,600,1800',
          )
            .split(',')
            .map((value) => count(value, 30))
          for (
            let attempt = 0;
            attempt < Math.max(1, count(config.maxAttempts, 4));
            attempt++
          ) {
            try {
              result = await fetchRelationshipPage(
                page,
                username,
                kind,
                progress.cursor,
                limit,
                targetMetadata,
              )
              break
            } catch (error) {
              shutdownSignal.throwIfAborted()
              if (
                /HTTP (401|403|404)/.test(String(error)) ||
                attempt + 1 >= Math.max(1, count(config.maxAttempts, 4))
              )
                throw error
              await sleep(
                (backoff[Math.min(attempt, backoff.length - 1)] || 30) * 1000,
              )
            }
          }
          if (!result) throw new Error('Failed to fetch relationship page')
          if (result.cursor && result.cursor === progress.cursor)
            throw new Error('Instagram returned a repeated pagination cursor')
          if (result.cursor && !result.users.length)
            throw new Error(
              'Instagram returned an empty page with more results',
            )
          const users = result.users.slice(0, limit)
          const freshUsers: User[] = []
          for (const user of users) {
            const id = String(
              user.pk ?? user.id ?? user.username ?? '',
            ).toLowerCase()
            if (id && !seen.has(id)) {
              seen.add(id)
              freshUsers.push(user)
            }
          }
          // Idempotent quota charge tied to this chunk commit. A crash after
          // the charge but before the checkpoint retries the same cursor with
          // the same key, and the server applies it at most once. Do not
          // reorder (charge after persist): a crash in between would advance
          // the cursor without ever charging.
          const quotaCommitKey = `${key}:chunk:${progress.chunks}`
          const quotaApplied = await profilesIncrementDailyScrapingUsed(
            profile.name,
            users.length,
            quotaCommitKey,
          )
          // Deduped means a previous attempt already charged this chunk and
          // the reloaded profile already includes it; do not count twice.
          if (quotaApplied)
            profile.daily_scraping_used =
              (profile.daily_scraping_used || 0) + users.length
          // Commit the chunk first. A crash before the checkpoint leaves an ignored
          // chunk which is safely replaced when this cursor is retried.
          const chunkFile = path.join(chunkRoot, `${progress.chunks}.json`)
          await fs.writeFile(`${chunkFile}.tmp`, JSON.stringify(freshUsers))
          await fs.rename(`${chunkFile}.tmp`, chunkFile)
          progress.scraped += freshUsers.length
          progress.targetCount += users.length
          progress.cursor = result.cursor
          progress.chunks++
          await persist('running')
          if (cap && progress.targetCount >= cap) break
          if (progress.cursor) await sleep(3000)
        } while (progress.cursor)
        progress.cursor = null
        progress.targetCount = 0
        // Save the next target before navigating so a restart cannot skip a partial target.
        progress.target++
        await persist('running')
      }
      progress.completed = true
      await persist('completed')
    } catch (error) {
      await persist('failed')
      throw error
    }
  }
  for (const account of accounts) await scrapingAccountComplete(account.id)
  state.completed = true
  await onProgress()
}
