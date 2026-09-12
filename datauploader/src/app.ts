import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { BatchResult, ConvexClient } from './convex.js'
import {
    countCsvRows,
    detectCsvFields,
    detectCsvSampleRow,
    readCsvRecords,
} from './csv.js'
import { loadAllKeywordSets } from './filter.js'
import { badRequest, errorResponse, jsonResponse, notFound, unprocessable, HttpError } from './http.js'
import {
    EXPORT_STORAGE_ID_KEYS,
    buildManifestPayload,
    extractChunkStorageIds,
    extractUsersFromPayload,
    getNestedStorageId,
    hasUserCollection,
    normalizeTaskRow,
    type JsonRecord,
} from './scrapingTasks.js'
import {
    archiveScrapingAccounts,
    extractUsernameFromUser,
    filterAndCollectAccounts,
    finalizeLocalArtifactImport,
    loadLocalArtifactPayload,
    type ArchivedAccount,
    type KeptAccount,
} from './tasks.js'
import { uploadAccountsToConvex, uploadUsernamesToConvex } from './uploader.js'

// REST API for CSV upload and scraping-task import. Same routes and JSON
// shapes as the old Python service; errors are `{ detail }`.

export interface AppDeps {
    client: ConvexClient
    uploadDir: string
}

interface JobStats {
    total_processed: number
    removed: number
    remaining: number
}

interface Job {
    status: 'uploaded' | 'processing' | 'completed' | 'failed'
    fileName: string
    filePath: string
    fields: string[]
    sampleRow: Record<string, string>
    rowCount: number
    stats?: JobStats
    uploaded?: Record<string, number>
    duplicates?: Record<string, number>
    error?: string
}

function toPublicStats(stats: JobStats): { totalProcessed: number; removed: number; remaining: number } {
    return {
        totalProcessed: stats.total_processed,
        removed: stats.removed,
        remaining: stats.remaining,
    }
}

async function readJsonBody(req: Request): Promise<JsonRecord> {
    try {
        const body: unknown = await req.json()
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            throw unprocessable('Invalid JSON body')
        }
        return body as JsonRecord
    } catch (err) {
        if (err instanceof HttpError) throw err
        throw unprocessable('Invalid JSON body')
    }
}

async function readUploadFile(req: Request): Promise<File> {
    let form: FormData
    try {
        form = await req.formData()
    } catch {
        throw unprocessable('file is required')
    }
    const file = form.get('file')
    if (!(file instanceof File) || !file.name) {
        throw unprocessable('file is required')
    }
    return file
}

function stringifyRecord(value: unknown): Record<string, string> {
    if (typeof value !== 'object' || value === null) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(value as JsonRecord)) {
        if (!k) continue
        out[k] = v == null ? '' : String(v)
    }
    return out
}

function cleanList(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.map((v) => String(v).trim()).filter(Boolean)
}

// Load a task plus its user payload, resolving local artifacts, export
// payloads, nested exports, and chunked manifests in order.
async function getTaskAndPayload(
    deps: AppDeps,
    taskId: string,
    env: string,
): Promise<{ task: JsonRecord; payload: JsonRecord }> {
    const { client, uploadDir } = deps
    const task = await client.getArtifactById(taskId, env)
    if (!task) {
        throw notFound('Task not found')
    }
    const normalizedTask = normalizeTaskRow(task)

    const localArtifactPath = String(task.localArtifactPath ?? '').trim()
    if (localArtifactPath) {
        const payload = await loadLocalArtifactPayload(uploadDir, localArtifactPath)
        payload.storageKind ??= 'local'
        payload.localArtifactPath ??= localArtifactPath
        return { task: normalizedTask, payload }
    }

    const primaryStorageIds: string[] = []
    const seenStorageIds = new Set<string>()
    for (const value of [task.exportStorageId, task.storageId, task.manifestStorageId]) {
        const cleaned = value == null ? '' : String(value).trim()
        if (cleaned && !seenStorageIds.has(cleaned)) {
            seenStorageIds.add(cleaned)
            primaryStorageIds.push(cleaned)
        }
    }

    const loadManifestPayload = async (
        manifestPayload: JsonRecord,
    ): Promise<JsonRecord> => {
        const chunkStorageIds = extractChunkStorageIds(manifestPayload, task)
        if (chunkStorageIds.length === 0) {
            return buildManifestPayload(task, manifestPayload, [])
        }
        const chunkPayloads = await Promise.all(
            chunkStorageIds.map((storageId) => client.fetchStorageJson(storageId, env)),
        )
        return buildManifestPayload(task, manifestPayload, chunkPayloads)
    }

    let primaryPayload: JsonRecord | null = null
    for (const storageId of primaryStorageIds) {
        const payload = await client.fetchStorageJson(storageId, env)
        if (primaryPayload === null) primaryPayload = payload

        if (hasUserCollection(payload)) {
            payload.storageKind = 'export'
            return { task: normalizedTask, payload }
        }

        const exportStorageId = getNestedStorageId(payload, EXPORT_STORAGE_ID_KEYS)
        if (exportStorageId) {
            const exportPayload = await client.fetchStorageJson(exportStorageId, env)
            if (hasUserCollection(exportPayload)) {
                exportPayload.storageKind = 'export'
                return { task: normalizedTask, payload: exportPayload }
            }
        }

        const chunkStorageIds = extractChunkStorageIds(payload, task)
        if (chunkStorageIds.length > 0 || task.manifestStorageId === storageId) {
            return { task: normalizedTask, payload: await loadManifestPayload(payload) }
        }
    }

    if (primaryPayload !== null && (task.manifestStorageId || task.chunkRefs)) {
        return { task: normalizedTask, payload: await loadManifestPayload(primaryPayload) }
    }
    if (task.chunkRefs) {
        return { task: normalizedTask, payload: await loadManifestPayload({}) }
    }
    throw badRequest('Task has no readable storage payload')
}

async function uploadToConvexEnvs(
    deps: AppDeps,
    accounts: KeptAccount[],
    environments: string[],
    status = 'available',
): Promise<{ uploaded: Record<string, number>; duplicates: Record<string, number> }> {
    const uploaded: Record<string, number> = {}
    const duplicates: Record<string, number> = {}
    for (const outEnv of environments) {
        const result = await uploadAccountsToConvex(deps.client, accounts, outEnv, status)
        uploaded[outEnv] = result.inserted
        duplicates[outEnv] = result.skipped
    }
    return { uploaded, duplicates }
}

export function createApp(deps: AppDeps): (req: Request) => Promise<Response> {
    const { client, uploadDir } = deps
    const jobs = new Map<string, Job>()

    return async (req: Request): Promise<Response> => {
        try {
            return await route(req)
        } catch (err) {
            return errorResponse(err)
        }
    }

    async function route(req: Request): Promise<Response> {
        const url = new URL(req.url)
        const segments = url.pathname.split('/').filter(Boolean)
        const method = req.method.toUpperCase()
        const queryEnv = url.searchParams.get('env') ?? 'dev'

        // GET /health
        if (method === 'GET' && segments.length === 1 && segments[0] === 'health') {
            return jsonResponse({ status: 'ok' })
        }

        // POST /keywords/upload
        if (method === 'POST' && segments.join('/') === 'keywords/upload') {
            const body = await readJsonBody(req)
            const filename = String(body.filename ?? '')
            const content = String(body.content ?? '')
            const env = String(body.env ?? 'dev')
            if (!filename || !content.trim()) {
                throw badRequest('filename and content are required')
            }
            try {
                const result = await client.upsertKeywords(filename, content, env)
                return jsonResponse({
                    status: 'ok',
                    ...(typeof result === 'object' && result !== null ? result : {}),
                })
            } catch (err) {
                throw new HttpError(500, err instanceof Error ? err.message : 'Unknown error')
            }
        }

        // POST /keywords/upload-file
        if (method === 'POST' && segments.join('/') === 'keywords/upload-file') {
            const file = await readUploadFile(req)
            if (!file.name.endsWith('.txt')) {
                throw badRequest('Only .txt files are accepted')
            }
            try {
                const content = await file.text()
                const result = await client.upsertKeywords(file.name, content, queryEnv)
                return jsonResponse({
                    status: 'ok',
                    filename: file.name,
                    ...(typeof result === 'object' && result !== null ? result : {}),
                })
            } catch (err) {
                if (err instanceof HttpError) throw err
                throw new HttpError(500, err instanceof Error ? err.message : 'Unknown error')
            }
        }

        // GET /keywords
        if (method === 'GET' && segments.length === 1 && segments[0] === 'keywords') {
            let entries: unknown = []
            try {
                entries = await client.listKeywords(queryEnv)
            } catch {
                entries = []
            }
            return jsonResponse({ keywords: Array.isArray(entries) ? entries : [] })
        }

        // DELETE /keywords/:filename
        if (method === 'DELETE' && segments.length === 2 && segments[0] === 'keywords') {
            const filename = decodeURIComponent(segments[1])
            try {
                const result = await client.removeKeywords(filename, queryEnv)
                return jsonResponse({
                    status: 'ok',
                    ...(typeof result === 'object' && result !== null ? result : {}),
                })
            } catch (err) {
                throw new HttpError(500, err instanceof Error ? err.message : 'Unknown error')
            }
        }

        // POST /upload
        if (method === 'POST' && segments.length === 1 && segments[0] === 'upload') {
            const file = await readUploadFile(req)
            if (!file.name.endsWith('.csv')) {
                throw badRequest('Only CSV files are accepted')
            }
            const jobId = crypto.randomUUID()
            const filePath = path.join(path.resolve(uploadDir), `${jobId}.csv`)
            try {
                await mkdir(path.dirname(filePath), { recursive: true })
                await Bun.write(filePath, file)
            } catch (err) {
                throw new HttpError(
                    500,
                    `Failed to save file: ${err instanceof Error ? err.message : err}`,
                )
            }
            let fields: string[]
            let sampleRow: Record<string, string>
            let rowCount: number
            try {
                const text = await Bun.file(filePath).text()
                fields = detectCsvFields(text)
                sampleRow = detectCsvSampleRow(text)
                rowCount = countCsvRows(text)
            } catch (err) {
                await rm(filePath, { force: true })
                throw badRequest(
                    `Failed to parse CSV: ${err instanceof Error ? err.message : err}`,
                )
            }
            jobs.set(jobId, {
                status: 'uploaded',
                fileName: file.name,
                filePath,
                fields,
                sampleRow,
                rowCount,
            })
            return jsonResponse({
                jobId,
                fileName: file.name,
                fields,
                sampleRow,
                rowCount,
            })
        }

        // GET /upload/:id/fields
        if (method === 'GET' && segments.length === 3 && segments[0] === 'upload' && segments[2] === 'fields') {
            const job = jobs.get(segments[1])
            if (!job) throw notFound('Job not found')
            return jsonResponse({
                fields: job.fields,
                sampleRow: job.sampleRow,
                rowCount: job.rowCount,
            })
        }

        // POST /upload/:id/process
        if (method === 'POST' && segments.length === 3 && segments[0] === 'upload' && segments[2] === 'process') {
            const jobId = segments[1]
            const job = jobs.get(jobId)
            if (!job) throw notFound('Job not found')
            if (job.status !== 'uploaded' && job.status !== 'completed' && job.status !== 'failed') {
                throw badRequest('Job is already processing')
            }
            // Claim the job before any await so a concurrent request
            // sees 'processing' instead of slipping through the guard.
            job.status = 'processing'
            const body = await readJsonBody(req)
            if (!(await Bun.file(job.filePath).exists())) {
                job.status = 'failed'
                job.error = 'Uploaded file not found'
                throw notFound('Uploaded file not found')
            }
            try {
                const keywordSets = await loadAllKeywordSets(client)
                const text = await Bun.file(job.filePath).text()
                const csvUsers = readCsvRecords(text)
                const { kept, totalProcessed, removed } = filterAndCollectAccounts(
                    csvUsers,
                    keywordSets,
                    null,
                )
                const stats: JobStats = {
                    total_processed: totalProcessed,
                    removed,
                    remaining: totalProcessed - removed,
                }
                job.stats = stats

                const uploaded: Record<string, number> = {}
                const duplicates: Record<string, number> = {}
                const uploadToConvex = body.uploadToConvex === true
                if (uploadToConvex && kept.length > 0) {
                    const envs = cleanList(body.environments)
                    const { uploaded: up, duplicates: dup } = await uploadToConvexEnvs(
                        deps,
                        kept,
                        envs,
                    )
                    Object.assign(uploaded, up)
                    Object.assign(duplicates, dup)
                }
                job.uploaded = uploaded
                job.duplicates = duplicates
                job.status = 'completed'
                return jsonResponse({
                    status: 'completed',
                    stats: toPublicStats(stats),
                    uploaded,
                    duplicates,
                })
            } catch (err) {
                if (err instanceof HttpError) {
                    job.status = 'failed'
                    job.error = err.message
                    throw err
                }
                job.status = 'failed'
                job.error = err instanceof Error ? err.message : 'Unknown error'
                throw new HttpError(500, job.error)
            }
        }

        // GET /upload/:id/status
        if (method === 'GET' && segments.length === 3 && segments[0] === 'upload' && segments[2] === 'status') {
            const job = jobs.get(segments[1])
            if (!job) throw notFound('Job not found')
            return jsonResponse({
                status: job.status,
                stats: job.stats ? toPublicStats(job.stats) : null,
                uploaded: job.uploaded ?? null,
                error: job.error ?? null,
            })
        }

        // DELETE /upload/:id
        if (method === 'DELETE' && segments.length === 2 && segments[0] === 'upload') {
            const jobId = segments[1]
            const job = jobs.get(jobId)
            if (!job) throw notFound('Job not found')
            const root = path.resolve(uploadDir)
            for (const suffix of ['', '_filtered']) {
                await rm(path.join(root, `${jobId}${suffix}.csv`), { force: true })
            }
            jobs.delete(jobId)
            return jsonResponse({ status: 'deleted' })
        }

        // GET /scraping-tasks
        if (method === 'GET' && segments.length === 1 && segments[0] === 'scraping-tasks') {
            const kind = url.searchParams.get('kind')
            try {
                const tasks = await client.listUnimported(kind ?? undefined, queryEnv)
                const list = Array.isArray(tasks) ? tasks : []
                const normalized = list
                    .filter((t): t is JsonRecord => typeof t === 'object' && t !== null && !Array.isArray(t))
                    .map(normalizeTaskRow)
                return jsonResponse({ tasks: normalized })
            } catch (err) {
                throw new HttpError(500, err instanceof Error ? err.message : 'Unknown error')
            }
        }

        // GET /scraping-tasks/:id/fields
        if (method === 'GET' && segments.length === 3 && segments[0] === 'scraping-tasks' && segments[2] === 'fields') {
            const taskId = decodeURIComponent(segments[1])
            try {
                const { payload } = await getTaskAndPayload(deps, taskId, queryEnv)
                const users = extractUsersFromPayload(payload)

                const fieldsSet = new Set<string>()
                let sampleUser: unknown = null
                for (const u of users.slice(0, 200)) {
                    if (sampleUser === null && u !== null && u !== undefined) {
                        sampleUser = u
                    }
                    if (typeof u === 'object' && u !== null) {
                        for (const k of Object.keys(u as JsonRecord)) {
                            if (k.trim()) fieldsSet.add(k.trim())
                        }
                    } else if (typeof u === 'string') {
                        fieldsSet.add('userName')
                    }
                }
                if (fieldsSet.size === 0) fieldsSet.add('userName')

                const sampleRow =
                    typeof sampleUser === 'string'
                        ? { userName: sampleUser }
                        : (() => {
                              const record = stringifyRecord(sampleUser)
                              return Object.keys(record).length > 0 ? record : { userName: '' }
                          })()

                return jsonResponse({
                    taskId,
                    env: queryEnv,
                    fields: [...fieldsSet].sort(),
                    sampleRow,
                    rowCount: users.length,
                })
            } catch (err) {
                if (err instanceof HttpError) throw err
                throw new HttpError(500, err instanceof Error ? err.message : 'Unknown error')
            }
        }

        // POST /scraping-tasks/:id/process
        if (method === 'POST' && segments.length === 3 && segments[0] === 'scraping-tasks' && segments[2] === 'process') {
            const taskId = decodeURIComponent(segments[1])
            const body = await readJsonBody(req)
            try {
                const env = String(body.env ?? 'dev')
                const { task, payload } = await getTaskAndPayload(deps, taskId, env)
                const uploadToConvex = body.uploadToConvex !== false
                if (task.imported === true && uploadToConvex) {
                    throw badRequest('Task already imported')
                }

                const keepFields = cleanList(body.keepFields)
                if (keepFields.length === 0) {
                    throw badRequest('keepFields is required')
                }

                const rawUsers = payload.users
                const users = Array.isArray(rawUsers)
                    ? rawUsers
                    : extractUsersFromPayload(payload)

                const keywordSets = await loadAllKeywordSets(client, env)
                const { kept, archived, totalProcessed, removed } = filterAndCollectAccounts(
                    users,
                    keywordSets,
                    {},
                )

                const archiveResult = await archiveScrapingAccounts(client, archived, env)
                const scrapingInserted = { [env]: archiveResult.inserted }
                const scrapingDuplicates = { [env]: archiveResult.skipped }

                let uploaded: Record<string, number> = {}
                let duplicates: Record<string, number> = {}
                if (uploadToConvex) {
                    const envs = cleanList(body.environments)
                    if (envs.length === 0) {
                        throw badRequest('environments is required when uploadToConvex is true')
                    }
                    const accountStatus = String(body.accountStatus ?? 'available')
                    ;({ uploaded, duplicates } = await uploadToConvexEnvs(
                        deps,
                        kept,
                        envs,
                        accountStatus,
                    ))
                    const localArtifactPath =
                        task.localArtifactPath != null ? String(task.localArtifactPath) : null
                    await finalizeLocalArtifactImport(
                        client,
                        uploadDir,
                        taskId,
                        env,
                        localArtifactPath,
                    )
                }

                return jsonResponse({
                    status: 'completed',
                    taskId,
                    env,
                    usernamesExtracted: kept.length,
                    stats: {
                        totalProcessed,
                        removed,
                        remaining: totalProcessed - removed,
                    },
                    uploaded,
                    duplicates,
                    scrapingInserted,
                    scrapingDuplicates,
                })
            } catch (err) {
                if (err instanceof HttpError) throw err
                throw new HttpError(500, err instanceof Error ? err.message : 'Unknown error')
            }
        }

        // POST /scraping-tasks/:id/import
        if (method === 'POST' && segments.length === 3 && segments[0] === 'scraping-tasks' && segments[2] === 'import') {
            const taskId = decodeURIComponent(segments[1])
            const body = await readJsonBody(req)
            const env = String(body.env ?? 'dev')
            const accountStatus = String(body.accountStatus ?? 'available')
            try {
                const { task, payload } = await getTaskAndPayload(deps, taskId, env)
                if (task.imported === true) {
                    throw badRequest('Task already imported')
                }

                const rawUsers = payload.users
                const users = Array.isArray(rawUsers)
                    ? rawUsers
                    : extractUsersFromPayload(payload)
                const publicUsers = users.filter(
                    (user) =>
                        !(typeof user === 'object' && user !== null &&
                            (user as JsonRecord).is_private === true),
                )
                const usernames: string[] = []
                const seen = new Set<string>()
                for (const user of publicUsers) {
                    const username = extractUsernameFromUser(user).replace(/^@+/, '')
                    if (!username) continue
                    const key = username.toLowerCase()
                    if (seen.has(key)) continue
                    seen.add(key)
                    usernames.push(username)
                }
                const result = await uploadUsernamesToConvex(client, usernames, env, accountStatus)
                await client.setImported(taskId, true, env)
                return jsonResponse({
                    taskId,
                    env,
                    usernamesExtracted: usernames.length,
                    inserted: result.inserted,
                    skipped: result.skipped,
                })
            } catch (err) {
                if (err instanceof HttpError) throw err
                throw new HttpError(500, err instanceof Error ? err.message : 'Unknown error')
            }
        }

        // POST /workflow-runs/process-scrape
        if (method === 'POST' && segments.join('/') === 'workflow-runs/process-scrape') {
            const body = await readJsonBody(req)
            try {
                const env = String(body.env ?? 'dev')
                if (!Array.isArray(body.users)) {
                    throw unprocessable('users must be an array')
                }
                const keywordSets = await loadAllKeywordSets(client, env)
                const { kept, totalProcessed, removed } = filterAndCollectAccounts(
                    body.users,
                    keywordSets,
                    null,
                )

                const envs = cleanList(body.environments)
                if (envs.length === 0) {
                    throw badRequest('environments is required')
                }
                const accountStatus = String(body.accountStatus ?? 'available')
                const { uploaded, duplicates } = await uploadToConvexEnvs(
                    deps,
                    kept,
                    envs,
                    accountStatus,
                )
                return jsonResponse({
                    status: 'completed',
                    workflowId: String(body.workflowId ?? ''),
                    nodeId: String(body.nodeId ?? ''),
                    kind: String(body.kind ?? ''),
                    stats: {
                        totalProcessed,
                        removed,
                        remaining: totalProcessed - removed,
                    },
                    uploaded,
                    duplicates,
                })
            } catch (err) {
                if (err instanceof HttpError) throw err
                throw new HttpError(500, err instanceof Error ? err.message : 'Unknown error')
            }
        }

        throw notFound('Not found')
    }
}

export type { BatchResult }
