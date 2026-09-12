import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { ConvexClient } from './convex.js'
import { filterWithKeywords, loadAllKeywordSets, type KeywordSets } from './filter.js'
import { HttpError, badRequest, notFound } from './http.js'
import {
    EXPORT_STORAGE_ID_KEYS,
    buildManifestPayload,
    extractChunkStorageIds,
    extractUsersFromPayload,
    getNestedStorageId,
    hasUserCollection,
    type JsonRecord,
} from './scrapingTasks.js'
import { iterBatches } from './uploader.js'

// In-memory CSV upload jobs plus local scraping-artifact handling.

// Resolve a task artifact path, confined to the upload directory.
export function resolveLocalArtifactPath(
    uploadDir: string,
    relativePath: string,
): string {
    const cleaned = (relativePath ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
    if (!cleaned) {
        throw new HttpError(400, 'Task has no local artifact path')
    }
    const uploadsRoot = path.resolve(uploadDir)
    const resolved = path.resolve(uploadsRoot, cleaned)
    if (resolved !== uploadsRoot && !resolved.startsWith(uploadsRoot + path.sep)) {
        throw new HttpError(400, 'Invalid local artifact path')
    }
    return resolved
}

export async function loadLocalArtifactPayload(
    uploadDir: string,
    relativePath: string,
): Promise<JsonRecord> {
    const inputPath = resolveLocalArtifactPath(uploadDir, relativePath)
    const file = Bun.file(inputPath)
    if (!(await file.exists())) {
        throw new HttpError(404, `Local artifact file not found: ${relativePath}`)
    }
    let payload: unknown
    try {
        payload = await file.json()
    } catch (err) {
        throw new HttpError(400, `Failed to read local artifact file: ${err instanceof Error ? err.message : err}`)
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new HttpError(400, `Invalid local artifact payload for ${relativePath}`)
    }
    return payload as JsonRecord
}

// Delete the local artifact only after Convex confirms the import.
// Restores the file if the Convex call fails.
export async function finalizeLocalArtifactImport(
    client: ConvexClient,
    uploadDir: string,
    taskId: string,
    env: string,
    localArtifactPath: string | null,
): Promise<void> {
    const cleaned = (localArtifactPath ?? '').trim()
    if (!cleaned) {
        await client.setImported(taskId, true, env)
        return
    }

    const filePath = resolveLocalArtifactPath(uploadDir, cleaned)
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
        throw new Error(`Local artifact file not found: ${cleaned}`)
    }

    // Move aside instead of reading into memory and deleting: on failure
    // the file is renamed back, so no data is lost and large artifacts
    // never sit in memory.
    const tmpPath = `${filePath}.finalizing-${crypto.randomUUID()}`
    await rename(filePath, tmpPath)
    try {
        await client.finalizeLocalImport(taskId, Date.now(), env)
    } catch (err) {
        await mkdir(path.dirname(filePath), { recursive: true })
        await rename(tmpPath, filePath)
        throw err
    }
    await rm(tmpPath)
}

const USERNAME_KEYS = ['userName', 'username', 'user_name', 'login', 'User Name'] as const
const FULLNAME_KEYS = ['full_name', 'fullName', 'name'] as const

// Extract a username from a user dict or raw string.
export function extractUsernameFromUser(user: unknown): string {
    if (typeof user === 'object' && user !== null) {
        const record = user as JsonRecord
        for (const key of USERNAME_KEYS) {
            const value = record[key]
            if (value != null && String(value).trim()) {
                return String(value).trim()
            }
        }
        return ''
    }
    if (typeof user === 'string') return user.trim()
    return ''
}

function extractFullnameFromUser(user: unknown): string {
    if (typeof user !== 'object' || user === null) return ''
    const record = user as JsonRecord
    for (const key of FULLNAME_KEYS) {
        const value = record[key]
        if (value == null) continue
        const text = String(value).trim()
        if (text) return text
    }
    return ''
}

export interface KeptAccount {
    userName: string
    fullName?: string
    matchedName?: string
}

export interface ArchivedAccount extends JsonRecord {
    userName: string
    status: string
    createdAt: number
}

function buildScrapingArchiveContext(_task: JsonRecord): JsonRecord {
    return {}
}

// Filter deduped users, optionally building archival rows.
export function filterAndCollectAccounts(
    users: unknown[],
    keywordSets: KeywordSets,
    archiveContext: JsonRecord | null = null,
): {
    kept: KeptAccount[]
    archived: ArchivedAccount[]
    totalProcessed: number
    removed: number
} {
    let totalProcessed = 0
    let removed = 0
    const kept: KeptAccount[] = []
    const archived: ArchivedAccount[] = []
    const seen = new Set<string>()
    const nowMs = Date.now()

    for (const u of users ?? []) {
        const username = extractUsernameFromUser(u)
        const cleanUsername = username.replace(/^@+/, '').trim()
        if (!cleanUsername) continue

        const key = cleanUsername.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        totalProcessed += 1

        // Skip private accounts.
        if (typeof u === 'object' && u !== null && (u as JsonRecord).is_private === true) {
            removed += 1
            continue
        }

        const fullname = extractFullnameFromUser(u)
        const [action, matchedName] = filterWithKeywords(username, fullname, keywordSets)

        const entry: KeptAccount = { userName: cleanUsername }
        if (fullname) entry.fullName = fullname
        if (matchedName) entry.matchedName = matchedName

        if (archiveContext !== null) {
            archived.push({
                userName: cleanUsername,
                status: 'need_scraping',
                createdAt: nowMs,
            })
        }

        if (action === 'remove') {
            removed += 1
            continue
        }
        kept.push(entry)
    }
    return { kept, archived, totalProcessed, removed }
}

// Archive deduped scraping accounts in 500-row batches. Throws with
// partial progress if any batch fails.
export async function archiveScrapingAccounts(
    client: ConvexClient,
    accounts: ArchivedAccount[],
    env: string,
): Promise<{ inserted: number; skipped: number }> {
    if (!accounts || accounts.length === 0) return { inserted: 0, skipped: 0 }
    const batches = [...iterBatches(accounts)]
    let inserted = 0
    let skipped = 0
    for (let index = 0; index < batches.length; index++) {
        try {
            const result = await client.insertScrapingAccounts(batches[index], env)
            inserted += result.inserted
            skipped += result.skipped
        } catch (err) {
            const reason = err instanceof Error ? err.message : 'Unknown error'
            const partialMessage =
                `Bulk scraping account archive failed after ${index}/${batches.length} batches; ` +
                `partial progress inserted=${inserted}, skipped=${skipped}. ${reason}`
            console.error(partialMessage)
            throw new Error(partialMessage)
        }
    }
    return { inserted, skipped }
}
