import type { ProfileRecord } from './contracts.js';
/**
 * Convex client for TypeScript using HTTP API.
 */
import '../env.js';

const convexCloudUrl = process.env.CONVEX_URL?.trim() || process.env.VITE_CONVEX_URL?.trim();
// Use INTERNAL_API_KEY to call Convex HTTP endpoints (same key as CONVEX_API_KEY in Convex Dashboard)
const convexApiKey = process.env.INTERNAL_API_KEY?.trim() || '';

if (!convexCloudUrl) {
    throw new Error('Convex config missing. Set CONVEX_URL (or VITE_CONVEX_URL) in environment.');
}

if (!convexApiKey) {
    throw new Error('Convex HTTP auth missing. Set INTERNAL_API_KEY in environment.');
}

// HTTP Actions are served at .convex.site, not .convex.cloud
// Convert the URL if needed
const convexUrl = convexCloudUrl.replace('.convex.cloud', '.convex.site');

// Database types
export type DbListRow = { id: string; name: string };

export type DbProfileRow = ProfileRecord;

export type ScrapingTaskStats = {
    scraped: number;
    deduped: number;
    chunksCompleted: number;
    targetsCompleted: number;
};

export type ProfileInput = {
    name: string;
    proxy?: string;
    proxyType?: string;
    fingerprintOs?: string;
    cookiesJson?: string;
    testIp?: boolean;
    dailyScrapingLimit?: number | null;
    assignedAccountsLimit?: number | null;
    sessionId?: string;
};

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

export interface ConvexRetryConfig {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries: number
    /** Base delay in milliseconds for exponential backoff (default: 1000) */
    baseDelay: number
}

const DEFAULT_RETRY_CONFIG: ConvexRetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
}

let retryConfig: ConvexRetryConfig = { ...DEFAULT_RETRY_CONFIG }

/**
 * Override default retry configuration.
 * Useful for testing or environment-specific tuning.
 */
export function setRetryConfig(config: Partial<ConvexRetryConfig>): void {
    retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config }
}

/**
 * Known network error codes from Node.js / libuv that indicate a
 * transient connectivity issue worth retrying.
 */
const RETRYABLE_ERROR_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
])

/**
 * Determine whether a failed request should be retried.
 *
 * Retryable conditions:
 *   - HTTP 429 (Too Many Requests)
 *   - HTTP 5xx (server errors)
 *   - Network / fetch errors (TypeError from fetch, known error codes)
 *
 * Non-retryable:
 *   - HTTP 4xx (client errors) except 429
 *   - JSON parse failures on successful responses
 *   - Any other unknown errors (safe default)
 */
function isRetryable(error: unknown): boolean {
    if (error instanceof ConvexHttpError) {
        const status = error.statusCode
        return status === 429 || status >= 500
    }

    // TypeError is thrown by fetch() on network failures
    if (error instanceof TypeError) {
        return true
    }

    // Node.js errors with a known network error code
    if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code?: string }).code
        if (typeof code === 'string' && RETRYABLE_ERROR_CODES.has(code)) {
            return true
        }
    }

    // Unknown errors — do NOT retry (safe default)
    return false
}

/**
 * Compute the delay before the next retry attempt.
 * Formula: baseDelay × 2^attempt + random jitter (0–baseDelay)
 */
function computeBackoff(attempt: number, baseDelay: number): number {
    const exponential = baseDelay * Math.pow(2, attempt)
    const jitter = Math.random() * baseDelay
    return exponential + jitter
}

/**
 * Typed error carrying the HTTP status from Convex.
 */
export class ConvexHttpError extends Error {
    public readonly statusCode: number
    constructor(statusCode: number, body: string) {
        super(`Convex HTTP error ${statusCode}: ${body}`)
        this.name = 'ConvexHttpError'
        this.statusCode = statusCode
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

// HTTP client for Convex with exponential backoff retry
async function convexFetch<T>(endpoint: string, options: { method?: string; body?: any; maxRetries?: number } = {}): Promise<T> {
    const url = `${convexUrl}${endpoint}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
    headers['Authorization'] = `Bearer ${convexApiKey}`;

    const { baseDelay } = retryConfig
    const maxRetries = options.maxRetries ?? retryConfig.maxRetries
    let lastError: unknown

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let resp: Response
        try {
            resp = await fetch(url, {
                signal: AbortSignal.timeout(30_000),
                method: options.method || 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
            });
            if (!resp.ok) {
                const text = await resp.text();
                throw new ConvexHttpError(resp.status, text);
            }
        } catch (err) {
            lastError = err

            const canRetry = attempt < maxRetries && isRetryable(err)
            if (!canRetry) {
                throw err
            }

            const delay = computeBackoff(attempt, baseDelay)
            await new Promise(resolve => setTimeout(resolve, delay))
            continue
        }

        // Parse JSON outside the retry try/catch — a parse error on a
        // 2xx response is a data issue, not a transient network failure.
        return resp.json() as Promise<T>;
    }

    // Unreachable in practice, but satisfies the compiler
    throw lastError
}

// ==================== LISTS ====================

export async function listsList(): Promise<DbListRow[]> {
    return convexFetch<DbListRow[]>('/api/lists');
}

export async function profilesList(): Promise<DbProfileRow[]> {
    return convexFetch<DbProfileRow[]>('/api/profiles');
}

export async function profilesGetById(profileId: string): Promise<DbProfileRow | null> {
    const cleaned = String(profileId || '').trim();
    if (!cleaned) throw new Error('id is required');
    return convexFetch<DbProfileRow | null>(`/api/profiles/by-id?profileId=${encodeURIComponent(cleaned)}`);
}

export async function profilesGetByName(name: string): Promise<DbProfileRow | null> {
    const cleaned = String(name || '').trim();
    if (!cleaned) throw new Error('name is required');
    return convexFetch<DbProfileRow | null>(`/api/profiles/by-name?name=${encodeURIComponent(cleaned)}`);
}

export async function profilesCreate(profile: ProfileInput): Promise<DbProfileRow | null> {
    const name = String(profile?.name || '').trim();
    if (!name) throw new Error('name is required');
    return convexFetch<DbProfileRow | null>('/api/profiles', {
        method: 'POST',
        body: {
            name,
            proxy: profile.proxy,
            proxyType: profile.proxyType,
            fingerprintOs: profile.fingerprintOs,
            cookiesJson: profile.cookiesJson,
            testIp: profile.testIp,
            dailyScrapingLimit: profile.dailyScrapingLimit,
            assignedAccountsLimit: profile.assignedAccountsLimit,
            sessionId: profile.sessionId,
        },
    });
}

export async function profilesUpdateByName(oldName: string, profile: ProfileInput): Promise<DbProfileRow | null> {
    const oldClean = String(oldName || '').trim();
    if (!oldClean) throw new Error('old_name is required');
    const name = String(profile?.name || '').trim();
    if (!name) throw new Error('name is required');
    return convexFetch<DbProfileRow | null>('/api/profiles/update-by-name', {
        method: 'POST',
        body: {
            oldName: oldClean,
            name,
            proxy: profile.proxy,
            proxyType: profile.proxyType,
            fingerprintOs: profile.fingerprintOs,
            cookiesJson: profile.cookiesJson,
            testIp: profile.testIp,
            dailyScrapingLimit: profile.dailyScrapingLimit,
            assignedAccountsLimit: profile.assignedAccountsLimit,
            sessionId: profile.sessionId,
        },
    });
}

export async function profilesDeleteByName(name: string): Promise<true> {
    const cleaned = String(name || '').trim();
    if (!cleaned) throw new Error('name is required');
    await convexFetch<any>('/api/profiles/delete-by-name', { method: 'POST', body: { name: cleaned } });
    return true;
}

export async function profilesSyncStatus(name: string, status: string, using: boolean = false): Promise<true> {
    const cleanedName = String(name || '').trim();
    const cleanedStatus = String(status || '').trim();
    if (!cleanedName || !cleanedStatus) throw new Error('name and status are required');
    await convexFetch<any>('/api/profiles/sync-status', { method: 'POST', body: { name: cleanedName, status: cleanedStatus, using } });
    return true;
}

export async function profilesSetLoginTrue(name: string): Promise<true> {
    const cleanedName = String(name || '').trim();
    if (!cleanedName) throw new Error('name is required');
    await convexFetch<any>('/api/profiles/set-login-true', { method: 'POST', body: { name: cleanedName } });
    return true;
}

export async function profilesIncrementDailyScrapingUsed(
    name: string,
    amount: number,
    commitKey?: string,
): Promise<boolean> {
    const cleanedName = String(name || '').trim();
    if (!cleanedName) throw new Error('name is required');
    const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
    if (safeAmount === 0) return true;
    const cleanedKey = typeof commitKey === 'string' ? commitKey.trim() : '';
    // Single attempt: a retry after a lost response would dedupe server-side
    // and return false, which the caller would misread as "already charged".
    // Let it throw instead; the outer scrape retry reuses the same commitKey.
    const res = await convexFetch<any>('/api/profiles/increment-daily-scraping-used', {
        method: 'POST',
        maxRetries: 0,
        body: cleanedKey
            ? { name: cleanedName, amount: safeAmount, commitKey: cleanedKey }
            : { name: cleanedName, amount: safeAmount },
    });
    // Server dedupes by commitKey: { ok: false } means this chunk was charged already.
    if (res && typeof res.ok === 'boolean') return res.ok !== false ? true : false;
    return true;
}

// ==================== MESSAGE TEMPLATES ====================

export async function messageTemplatesGet(kind: string): Promise<string[]> {
    const cleaned = String(kind || '').trim();
    if (!cleaned) throw new Error('kind is required');
    const result = await convexFetch<string[] | null>(`/api/message-templates?kind=${encodeURIComponent(cleaned)}`);
    return Array.isArray(result) ? result : [];
}

export type InstagramAccount = {
    id: string;
    user_name: string;
    status?: string | null;
    message?: boolean;
};

export async function instagramAccountsForProfile(profileId: string, status = 'assigned'): Promise<InstagramAccount[]> {
    const result = await convexFetch<InstagramAccount[]>(
        `/api/instagram-accounts/for-profile?profileId=${encodeURIComponent(profileId)}&status=${encodeURIComponent(status)}`,
    );
    return Array.isArray(result) ? result : [];
}

export async function instagramAccountsToMessage(profileId: string, cooldownHours = 0): Promise<InstagramAccount[]> {
    const result = await convexFetch<InstagramAccount[]>(
        `/api/instagram-accounts/to-message?profileId=${encodeURIComponent(profileId)}&cooldownHours=${encodeURIComponent(String(cooldownHours))}`,
    );
    return Array.isArray(result) ? result : [];
}

export async function instagramAccountUpdateStatus(id: string, status: string): Promise<void> {
    await convexFetch('/api/instagram-accounts/update-status', {
        method: 'POST',
        body: { id, status },
    });
}

export async function instagramAccountUpdateMessage(userName: string): Promise<void> {
    await convexFetch('/api/instagram-accounts/update-message', {
        method: 'POST',
        body: { user_name: userName, message: true, last_messaged_at: Date.now() },
    });
}

// ==================== SCRAPE JOBS ====================

export type ScrapeJobConfig = {
    maxToScrape: number;
    maxAttempts: number;
    retryBackoffSeconds: string;
    openDelaySeconds: number;
    fields: { fullName: boolean; isVerified: boolean; isPrivate: boolean };
    skip: { private: boolean; verified: boolean; noFullName: boolean };
};

export type ScrapeJobStats = {
    scraped: number;
    deduped: number;
    chunksCompleted: number;
    targetsCompleted: number;
};

export type DbScrapeJobRow = {
    _id: string;
    name: string;
    targets: string[];
    listIds: string[];
    status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
    config: ScrapeJobConfig;
    stats: ScrapeJobStats;
    error?: string;
    startedAt?: number;
    completedAt?: number;
    createdAt?: number;
    updatedAt?: number;
};

export type ScrapedAccountInsert = {
    userName: string;
    fullName?: string;
    isVerified?: boolean;
    isPrivate?: boolean;
    sourceJobId?: string;
};

export async function instagramAccountsInsertMany(
    accounts: ScrapedAccountInsert[],
): Promise<{ inserted: number; existed: number; skipped: number }> {
    if (!accounts.length) return { inserted: 0, existed: 0, skipped: 0 };
    return convexFetch('/api/instagram-accounts/insert-many', { method: 'POST', body: { accounts } });
}

// Usernames already saved for a job, used to resume a scrape without
// re-saving rows. Mirrors igscrape seeding existingIDs from Convex.
export async function instagramAccountsByJob(jobId: string): Promise<Array<{ userName: string }>> {
    const cleaned = String(jobId || '').trim();
    if (!cleaned) throw new Error('jobId is required');
    const result = await convexFetch<Array<{ userName?: string; user_name?: string }>>(
        `/api/instagram-accounts/by-job?jobId=${encodeURIComponent(cleaned)}`,
    );
    return (Array.isArray(result) ? result : []).map((account) => ({
        userName: String(account?.userName ?? account?.user_name ?? ''),
    }));
}

export async function scrapeJobsGetById(jobId: string): Promise<DbScrapeJobRow | null> {
    const cleaned = String(jobId || '').trim();
    if (!cleaned) throw new Error('jobId is required');
    return convexFetch<DbScrapeJobRow | null>(`/api/scrape-jobs/by-id?jobId=${encodeURIComponent(cleaned)}`);
}

export async function scrapeJobsStart(jobId: string): Promise<DbScrapeJobRow | null> {
    const cleaned = String(jobId || '').trim();
    if (!cleaned) throw new Error('jobId is required');
    return convexFetch<DbScrapeJobRow | null>('/api/scrape-jobs/start', { method: 'POST', body: { id: cleaned } });
}

export async function scrapeJobsFinish(
    jobId: string,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string,
    stats?: ScrapingTaskStats,
): Promise<DbScrapeJobRow | null> {
    const cleaned = String(jobId || '').trim();
    if (!cleaned) throw new Error('jobId is required');
    return convexFetch<DbScrapeJobRow | null>('/api/scrape-jobs/finish', {
        method: 'POST',
        body: { id: cleaned, status, error, stats },
    });
}

export async function scrapeJobsUpdateStats(jobId: string, stats: ScrapingTaskStats): Promise<void> {
    const cleaned = String(jobId || '').trim();
    if (!cleaned) throw new Error('jobId is required');
    await convexFetch('/api/scrape-jobs/update-stats', { method: 'POST', body: { id: cleaned, stats } });
}

export async function scrapeJobsReconcileInterrupted(): Promise<{ reconciled: number }> {
    return convexFetch('/api/scrape-jobs/reconcile', { method: 'POST', body: {} });
}

// ==================== WORKFLOWS ====================

export type DbWorkflowRow = {
    _id: string
    name: string
    nodes: import('../automation/graph.js').WorkflowNode[]
    edges: import('../automation/graph.js').WorkflowEdge[]
    status?: string
    currentNodeId?: string
    nodeStates?: Record<string, unknown>
}

export async function workflowsGetById(workflowId: string): Promise<DbWorkflowRow | null> {
    const cleaned = String(workflowId || '').trim()
    if (!cleaned) throw new Error('workflowId is required')
    return convexFetch<DbWorkflowRow | null>(`/api/workflows/by-id?workflowId=${encodeURIComponent(cleaned)}`)
}

export async function workflowsStart(workflowId: string): Promise<DbWorkflowRow | null> {
    const cleaned = String(workflowId || '').trim()
    if (!cleaned) throw new Error('workflowId is required')
    return convexFetch<DbWorkflowRow | null>('/api/workflows/start', { method: 'POST', body: { id: cleaned } })
}

export async function workflowsUpdateStatus(input: {
    workflowId: string
    status: string
    currentNodeId?: string
    nodeStates?: any
    error?: string
}): Promise<DbWorkflowRow | null> {
    const cleaned = String(input?.workflowId || '').trim()
    if (!cleaned) throw new Error('workflowId is required')
    return convexFetch<DbWorkflowRow | null>('/api/workflows/update-status', {
        method: 'POST',
        body: {
            id: cleaned,
            status: input.status,
            currentNodeId: input.currentNodeId,
            nodeStates: input.nodeStates,
            error: input.error,
        },
    })
}



export async function workflowsReconcileInterrupted(): Promise<{ reconciled: number }> {
    return convexFetch('/api/workflows/reconcile', { method: 'POST', body: {} });
}
