// Helpers for scraping-task payloads and manifest/chunk storage.
// Direct port of the old Python module, same key fallbacks.

export const USER_COLLECTION_KEYS = ['users', 'rawUsers', 'accounts'] as const
export const EXPORT_STORAGE_ID_KEYS = ['exportStorageId', 'export_storage_id'] as const
const CHUNK_COLLECTION_KEYS = [
    'chunkRefs',
    'chunks',
    'chunkStorageIds',
    'chunk_storage_ids',
    'chunkIds',
    'chunk_ids',
    'artifacts',
    'files',
] as const
const CHUNK_STORAGE_ID_KEYS = [
    'storageId',
    'storage_id',
    'chunkStorageId',
    'chunk_storage_id',
    'id',
] as const

export type JsonRecord = Record<string, unknown>

function cleanStorageId(value: unknown): string | null {
    if (value == null) return null
    const cleaned = String(value).trim()
    return cleaned || null
}

function appendUniqueStorageId(
    storageIds: string[],
    seen: Set<string>,
    value: unknown,
): void {
    const storageId = cleanStorageId(value)
    if (!storageId || seen.has(storageId)) return
    seen.add(storageId)
    storageIds.push(storageId)
}

export function getNestedStorageId(
    payload: unknown,
    keys: readonly string[],
): string | null {
    if (typeof payload !== 'object' || payload === null) return null
    const record = payload as JsonRecord
    for (const key of keys) {
        const storageId = cleanStorageId(record[key])
        if (storageId) return storageId
    }
    return null
}

export function hasUserCollection(payload: unknown): boolean {
    if (typeof payload !== 'object' || payload === null) return false
    const record = payload as JsonRecord
    return USER_COLLECTION_KEYS.some((key) => Array.isArray(record[key]))
}

export function extractUsersFromPayload(payload: unknown): unknown[] {
    if (typeof payload !== 'object' || payload === null) return []
    const record = payload as JsonRecord

    for (const key of USER_COLLECTION_KEYS) {
        const value = record[key]
        if (Array.isArray(value)) return value
    }

    const collected: unknown[] = []
    for (const key of ['chunks', 'artifacts', 'files']) {
        const value = record[key]
        if (!Array.isArray(value)) continue
        for (const item of value) {
            collected.push(...extractUsersFromPayload(item))
        }
        if (collected.length > 0) return collected
    }
    return []
}

export function extractChunkStorageIds(
    manifestPayload: unknown,
    task?: JsonRecord | null,
): string[] {
    const storageIds: string[] = []
    const seen = new Set<string>()

    if (typeof manifestPayload === 'object' && manifestPayload !== null) {
        const record = manifestPayload as JsonRecord
        for (const key of CHUNK_COLLECTION_KEYS) {
            const value = record[key]
            if (!Array.isArray(value)) continue
            for (const item of value) {
                if (typeof item === 'string') {
                    appendUniqueStorageId(storageIds, seen, item)
                    continue
                }
                if (typeof item !== 'object' || item === null) continue
                const itemRecord = item as JsonRecord
                for (const itemKey of CHUNK_STORAGE_ID_KEYS) {
                    if (itemKey in itemRecord) {
                        appendUniqueStorageId(storageIds, seen, itemRecord[itemKey])
                        break
                    }
                }
            }
        }
    }

    if (task && typeof task === 'object') {
        const chunkRefs = task.chunkRefs
        if (Array.isArray(chunkRefs)) {
            for (const item of chunkRefs) {
                if (typeof item !== 'object' || item === null) continue
                appendUniqueStorageId(storageIds, seen, (item as JsonRecord).storageId)
            }
        }
    }
    return storageIds
}

export function estimateTaskRowCount(task: JsonRecord): number | null {
    const stats = task.stats
    if (typeof stats === 'object' && stats !== null) {
        const statsRecord = stats as JsonRecord
        const deduped = statsRecord.deduped
        if (typeof deduped === 'number' && deduped >= 0) return Math.floor(deduped)
        const scraped = statsRecord.scraped
        if (typeof scraped === 'number' && scraped >= 0) return Math.floor(scraped)
    }

    const chunkRefs = task.chunkRefs
    if (Array.isArray(chunkRefs)) {
        let total = 0
        let found = false
        for (const item of chunkRefs) {
            if (typeof item !== 'object' || item === null) continue
            const count = (item as JsonRecord).count
            if (typeof count === 'number' && count >= 0) {
                total += Math.floor(count)
                found = true
            }
        }
        if (found) return total
    }
    return null
}

export function normalizeTaskRow(task: unknown): JsonRecord {
    if (typeof task !== 'object' || task === null) return {}
    const record = task as JsonRecord
    const normalized: JsonRecord = { ...record }

    const effectiveStorageId =
        cleanStorageId(record.exportStorageId) ??
        cleanStorageId(record.manifestStorageId) ??
        cleanStorageId(record.storageId)
    if (effectiveStorageId) normalized.storageId = effectiveStorageId

    const rowCount = estimateTaskRowCount(record)
    if (rowCount != null) normalized.rowCount = rowCount

    if (!normalized.targetUsername) {
        const targets = normalized.targets
        if (Array.isArray(targets)) {
            const cleaned = targets
                .map((value) => String(value).trim())
                .filter(Boolean)
            if (cleaned.length > 0) {
                normalized.targetUsername = cleaned.join('\n')
            }
        }
    }
    return normalized
}

export function buildManifestPayload(
    task: JsonRecord,
    manifestPayload: unknown,
    chunkPayloads: JsonRecord[],
): JsonRecord {
    const combined: JsonRecord =
        typeof manifestPayload === 'object' && manifestPayload !== null
            ? { ...(manifestPayload as JsonRecord) }
            : {}
    const users: unknown[] = []
    for (const payload of chunkPayloads) {
        users.push(...extractUsersFromPayload(payload))
    }
    combined.users = users
    combined.chunkCount = chunkPayloads.length
    combined.storageKind = 'manifest'
    if (!('taskId' in combined)) combined.taskId = task._id
    return combined
}
