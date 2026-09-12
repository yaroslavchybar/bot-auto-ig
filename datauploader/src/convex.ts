import type { JsonRecord } from './scrapingTasks.js'

// Convex access over HTTP. Reads CONVEX_URL_DEV (falling back to
// CONVEX_URL), CONVEX_URL_PROD, and INTERNAL_API_KEY from the environment.

// Outbound requests must not hang forever on stalled connections.
const REQUEST_TIMEOUT_MS = 60_000

export interface BatchResult {
    inserted: number
    skipped: number
}

// High-level operations the routes need. Tests inject fakes of this.
export interface ConvexClient {
    listUnimported(kind: string | undefined, env: string): Promise<unknown>
    getArtifactById(id: string, env: string): Promise<JsonRecord | null>
    fetchStorageJson(storageId: string, env: string): Promise<JsonRecord>
    setImported(id: string, imported: boolean, env: string): Promise<unknown>
    finalizeLocalImport(id: string, deletedAt: number, env: string): Promise<unknown>
    insertAccounts(accounts: JsonRecord[], env: string): Promise<BatchResult>
    insertScrapingAccounts(accounts: JsonRecord[], env: string): Promise<BatchResult>
    upsertKeywords(filename: string, content: string, env: string): Promise<unknown>
    removeKeywords(filename: string, env: string): Promise<unknown>
    listKeywords(env: string): Promise<unknown>
    getKeyword(filename: string, env: string): Promise<string | null>
}

export function getConvexUrl(env = 'dev'): string {
    if (env === 'prod') {
        const url = process.env.CONVEX_URL_PROD
        if (!url) throw new Error('Missing CONVEX_URL_PROD in environment')
        return url
    }
    const url = process.env.CONVEX_URL_DEV ?? process.env.CONVEX_URL
    if (!url) throw new Error('Missing CONVEX_URL_DEV or CONVEX_URL in environment')
    return url
}

function getConvexSiteUrl(env = 'dev'): string {
    return getConvexUrl(env).replace('.convex.cloud', '.convex.site')
}

export function getInternalApiKey(): string {
    const token = (process.env.INTERNAL_API_KEY ?? '').trim()
    if (!token) throw new Error('Missing INTERNAL_API_KEY in environment')
    return token
}

async function internalFetch(
    endpoint: string,
    options: { method?: string; body?: unknown; env?: string } = {},
): Promise<unknown> {
    const { method = 'GET', body, env = 'dev' } = options
    const res = await fetch(`${getConvexSiteUrl(env)}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getInternalApiKey()}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
        throw new Error(`Convex request failed: ${res.status} ${endpoint}`)
    }
    if (res.status === 204) return null
    return res.json()
}

function toBatchResult(value: unknown, what: string): BatchResult {
    if (typeof value !== 'object' || value === null) {
        throw new Error(`Invalid ${what} response`)
    }
    const record = value as JsonRecord
    return {
        inserted: Number(record.inserted ?? 0),
        skipped: Number(record.skipped ?? 0),
    }
}

async function insertBatch(
    endpoint: string,
    accounts: JsonRecord[],
    env: string,
): Promise<BatchResult> {
    try {
        const value = await internalFetch(endpoint, {
            method: 'POST',
            body: { accounts },
            env,
        })
        return toBatchResult(value, endpoint)
    } catch (err) {
        throw new Error(err instanceof Error ? err.message : 'Unknown error')
    }
}

export function createConvexClient(): ConvexClient {
    return {
        async listUnimported(kind, env) {
            const endpoint =
                kind != null && kind !== ''
                    ? `/api/workflow-artifacts/unimported?kind=${encodeURIComponent(kind)}`
                    : '/api/workflow-artifacts/unimported'
            return internalFetch(endpoint, { env })
        },

        async getArtifactById(id, env) {
            const value = await internalFetch(
                `/api/workflow-artifacts/by-id?id=${encodeURIComponent(id)}`,
                { env },
            )
            if (typeof value !== 'object' || value === null) return null
            return value as JsonRecord
        },

        async fetchStorageJson(storageId, env) {
            const url = await internalFetch(
                `/api/workflow-artifacts/storage-url?storageId=${encodeURIComponent(storageId)}`,
                { env },
            )
            if (!url || typeof url !== 'string') {
                throw new Error(`Could not get storage URL for ${storageId}`)
            }
            const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
            if (!res.ok) {
                throw new Error(`Storage download failed: ${res.status} for ${storageId}`)
            }
            const payload: unknown = await res.json()
            if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
                throw new Error(`Invalid task file payload for ${storageId}`)
            }
            return payload as JsonRecord
        },

        async setImported(id, imported, env) {
            return internalFetch('/api/workflow-artifacts/set-imported', {
                method: 'POST',
                body: { id, imported },
                env,
            })
        },

        async finalizeLocalImport(id, deletedAt, env) {
            return internalFetch('/api/workflow-artifacts/finalize-local-import', {
                method: 'POST',
                body: { id, imported: true, deletedAt },
                env,
            })
        },

        async insertAccounts(accounts, env) {
            return insertBatch('/api/instagram-accounts/batch', accounts, env)
        },

        async insertScrapingAccounts(accounts, env) {
            return insertBatch('/api/scraping-accounts/batch', accounts, env)
        },

        async upsertKeywords(filename, content, env) {
            return internalFetch('/api/keywords', {
                method: 'POST',
                body: { filename, content },
                env,
            })
        },

        async removeKeywords(filename, env) {
            return internalFetch('/api/keywords/delete', {
                method: 'POST',
                body: { filename },
                env,
            })
        },

        async listKeywords(env) {
            return internalFetch('/api/keywords', { env })
        },

        async getKeyword(filename, env) {
            try {
                const value = await internalFetch(
                    `/api/keywords?filename=${encodeURIComponent(filename)}`,
                    { env },
                )
                return typeof value === 'string' ? value : null
            } catch {
                return null
            }
        },
    }
}
