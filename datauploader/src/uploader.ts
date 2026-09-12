import type { ConvexClient } from './convex.js'
import type { JsonRecord } from './scrapingTasks.js'

// Bulk upload of filtered accounts into Convex.

export const BATCH_SIZE = 500

export interface UploadResult {
    inserted: number
    skipped: number
}

// Yield deterministic slices for bulk uploads.
export function* iterBatches<T>(items: T[], batchSize = BATCH_SIZE): Generator<T[]> {
    const safeBatchSize = Math.max(1, Math.floor(batchSize || BATCH_SIZE))
    for (let index = 0; index < items.length; index += safeBatchSize) {
        yield items.slice(index, index + safeBatchSize)
    }
}

export interface PreparedAccount extends JsonRecord {
    userName: string
    status: string
    message: boolean
    createdAt: number
}

// Build an account record with all required fields.
export function prepareAccount(
    username: string,
    status = 'available',
    fullName?: string | null,
    matchedName?: string | null,
): PreparedAccount {
    const account: PreparedAccount = {
        userName: username,
        status,
        message: false,
        createdAt: Date.now(),
    }
    if (fullName != null) account.fullName = fullName
    if (matchedName != null) account.matchedName = matchedName
    return account
}

function cleanUsername(value: unknown): string | null {
    if (value == null) return null
    const cleaned = String(value).trim().replace(/^@+/, '')
    return cleaned || null
}

// Upload a username list to one environment.
export async function uploadUsernamesToConvex(
    client: ConvexClient,
    usernames: string[],
    env = 'dev',
    status = 'available',
): Promise<UploadResult> {
    const cleaned = (usernames ?? [])
        .map((u) => cleanUsername(u))
        .filter((u): u is string => u != null)
    if (cleaned.length === 0) return { inserted: 0, skipped: 0 }

    let inserted = 0
    let skipped = 0
    for (const batch of iterBatches(cleaned)) {
        const accounts = batch.map((u) => prepareAccount(u, status))
        const result = await client.insertAccounts(accounts, env)
        inserted += result.inserted
        skipped += result.skipped
    }
    return { inserted, skipped }
}

export interface AccountData {
    userName: string
    fullName?: string
    matchedName?: string
}

// Upload accounts with full metadata (fullName, matchedName).
export async function uploadAccountsToConvex(
    client: ConvexClient,
    accountsData: AccountData[],
    env = 'dev',
    status = 'available',
): Promise<UploadResult> {
    if (!accountsData || accountsData.length === 0) {
        return { inserted: 0, skipped: 0 }
    }

    let inserted = 0
    let skipped = 0
    for (const batch of iterBatches(accountsData)) {
        const prepared = batch
            .filter((a) => cleanUsername(a?.userName) != null)
            .map((a) =>
                prepareAccount(
                    cleanUsername(a.userName) as string,
                    status,
                    a.fullName ?? null,
                    a.matchedName ?? null,
                ),
            )
        if (prepared.length === 0) continue
        const result = await client.insertAccounts(prepared, env)
        inserted += result.inserted
        skipped += result.skipped
    }
    return { inserted, skipped }
}
