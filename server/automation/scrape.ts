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
type User = {
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
  users: User[]
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
) {
  return page.evaluate(
    async ({ username, kind, cursor, limit }) => {
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
      const metadata = await request(
        `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      )
      const userId = metadata.data?.user?.id || metadata.data?.user?.pk
      if (!userId) throw new Error('Target profile not found')
      const params = new URLSearchParams({ count: String(limit) })
      if (cursor) params.set('max_id', cursor)
      const body = await request(
        `/api/v1/friendships/${encodeURIComponent(String(userId))}/${kind}/?${params}`,
      )
      const users = body.users ?? body.profiles
      if (!Array.isArray(users))
        throw new Error('Invalid relationship response')
      const total =
        kind === 'followers'
          ? metadata.data.user.edge_followed_by?.count
          : metadata.data.user.edge_follow?.count
      if (!cursor && users.length === 0 && Number(total) > 0)
        throw new Error(
          'Instagram returned an incomplete empty relationship list',
        )
      return {
        users: users as User[],
        cursor:
          body.next_max_id == null || body.big_list === false
            ? null
            : String(body.next_max_id) || null,
      }
    },
    { username, kind, cursor, limit },
  )
}

export async function scrapeRelationships(input: {
  page: Page
  profile: DbProfileRow
  workflowId: string
  workflowName: string
  nodeId: string
  config: Record<string, unknown>
  state: Record<string, any>
  onProgress: () => void
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
      users: [],
      completed: false,
    }
    try {
      progress = JSON.parse(await fs.readFile(filename, 'utf8')).progress
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const seen = new Set(
      progress.users.map((user) =>
        String(user.pk ?? user.id ?? user.username).toLowerCase(),
      ),
    )
    const persist = async (status: string) => {
      const payload = {
        workflowId,
        nodeId,
        kind,
        targets,
        users: progress.users,
        count: progress.users.length,
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
          scraped: progress.users.length,
          deduped: progress.users.length,
          chunksCompleted: progress.chunks,
          targetsCompleted: progress.target,
        },
      })
      onProgress()
    }
    try {
      while (progress.target < targets.length) {
        shutdownSignal.throwIfAborted()
        const username = targets[progress.target]
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
          for (const user of users) {
            const id = String(
              user.pk ?? user.id ?? user.username ?? '',
            ).toLowerCase()
            if (id && !seen.has(id)) {
              seen.add(id)
              progress.users.push(user)
            }
          }
          await profilesIncrementDailyScrapingUsed(profile.name, users.length)
          profile.daily_scraping_used =
            (profile.daily_scraping_used || 0) + users.length
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
  onProgress()
}
