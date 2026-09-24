import type { ProfileRecord } from './contracts.js';
import type { ChatThread } from '../chat/instagram.js';
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

export type ProfileInput = {
    name: string;
    proxy?: string;
    proxyType?: string;
    fingerprintOs?: string;
    cookiesJson?: string;
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

/** Authenticated calls from the scraper worker to Convex internal functions. */
export function scraperRequest<T>(operation: string, body: Record<string, unknown> = {}): Promise<T> {
    if (!/^[a-z-]+$/.test(operation)) throw new Error('Invalid scraper operation');
    return convexFetch<T>(`/api/scraper/${operation}`, { method: 'POST', body });
}

export function leadListRequest(operation: 'rename' | 'delete', body: Record<string, unknown>): Promise<{ ok: true }> {
    return convexFetch(`/api/lead-lists/${operation}`, { method: 'POST', body });
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

export type ChatSessionFile = { connected: false } | { connected: true; state: string; token: string };

export function chatSessionGet(profileId: string): Promise<ChatSessionFile> {
    return convexFetch(`/api/chat/session?profileId=${encodeURIComponent(profileId)}`, { maxRetries: 1 });
}

export function chatSessionHas(profileId: string): Promise<{ connected: boolean }> {
    return convexFetch(`/api/chat/session?profileId=${encodeURIComponent(profileId)}&status=1`, { maxRetries: 1 });
}

export function chatSessionSave(profileId: string, state: string, token: string, expectedToken?: string): Promise<{ connected: true }> {
    return convexFetch('/api/chat/session', {
        method: 'POST', body: { profileId, state, token, expectedToken }, maxRetries: 0,
    });
}

export function chatSessionDelete(profileId: string): Promise<{ connected: false }> {
    return convexFetch(`/api/chat/session?profileId=${encodeURIComponent(profileId)}`, {
        method: 'DELETE', maxRetries: 0,
    });
}

export type CachedChatInbox = { connected: boolean; viewerId: string; threads: ChatThread[]; syncedAt: number };
export type CachedChatThread = ChatThread & { syncedAt: number };

export function chatCacheInbox(profileId: string): Promise<CachedChatInbox> {
    return convexFetch(`/api/chat/cache?profileId=${encodeURIComponent(profileId)}`, { maxRetries: 1 });
}

export function chatCacheThread(profileId: string, threadId: string): Promise<CachedChatThread | null> {
    return convexFetch(`/api/chat/cache?profileId=${encodeURIComponent(profileId)}&threadId=${encodeURIComponent(threadId)}`, { maxRetries: 1 });
}

export function chatCacheSaveInbox(profileId: string, token: string, inbox: { viewerId: string; threads: ChatThread[] },
    mode: 'full' | 'unread' = 'full'): Promise<CachedChatInbox> {
    return convexFetch('/api/chat/cache', { method: 'POST', maxRetries: 0,
        body: { scope: 'inbox', profileId, token, mode, ...inbox } });
}

export function chatMarkReplied(profileId: string, token: string, threadId: string, throughAt: number): Promise<void> {
    return convexFetch('/api/chat/cache', { method: 'POST', maxRetries: 1,
        body: { scope: 'replied', profileId, token, threadId, throughAt } }).then(() => {});
}

export function chatMarkUnsent(profileId: string, token: string, threadId: string, messageId: string): Promise<void> {
    return convexFetch('/api/chat/cache', { method: 'POST', maxRetries: 1,
        body: { scope: 'unsent', profileId, token, threadId, messageId } }).then(() => {});
}

export function chatCacheSaveThread(profileId: string, token: string, thread: ChatThread): Promise<CachedChatThread> {
    return convexFetch('/api/chat/cache', { method: 'POST', maxRetries: 0,
        body: { scope: 'thread', profileId, token, thread } });
}

// ==================== AUTOMATIONS ====================

export type DbAutomationRow = {
    listIds?: string[]
    routine?: { activity: Record<string, number | boolean>; headless: boolean }
    _id: string
    name: string
    nodes: import('../automation/graph.js').AutomationNode[]
    edges: import('../automation/graph.js').AutomationEdge[]
    status?: string
    isActive?: boolean
    currentNodeId?: string
    nodeStates?: Record<string, unknown>
}

export async function automationsGetById(automationId: string): Promise<DbAutomationRow | null> {
    const cleaned = String(automationId || '').trim()
    if (!cleaned) throw new Error('automationId is required')
    return convexFetch<DbAutomationRow | null>(`/api/automations/by-id?automationId=${encodeURIComponent(cleaned)}`)
}

export async function automationsStart(automationId: string): Promise<DbAutomationRow | null> {
    const cleaned = String(automationId || '').trim()
    if (!cleaned) throw new Error('automationId is required')
    return convexFetch<DbAutomationRow | null>('/api/automations/start', { method: 'POST', body: { id: cleaned } })
}

export async function automationsUpdateStatus(input: {
    automationId: string
    status: string
    currentNodeId?: string
    nodeStates?: any
    error?: string
}): Promise<DbAutomationRow | null> {
    const cleaned = String(input?.automationId || '').trim()
    if (!cleaned) throw new Error('automationId is required')
    return convexFetch<DbAutomationRow | null>('/api/automations/update-status', {
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



export async function automationsReconcileInterrupted(): Promise<{ reconciled: number }> {
    let reconciled = 0;
    while (true) {
        const batch = await convexFetch<{ reconciled: number; hasMore?: boolean }>('/api/automations/reconcile', { method: 'POST', body: {} });
        reconciled += batch.reconciled;
        if (!batch.hasMore) return { reconciled };
    }
}

// ==================== WARM-UP ====================

export type DbWarmupState = {
    id: string
    profileId: string
    day: number
    date: string
    runsToday: number
    todayMinutes: number
    minutesUsedToday: number
    reservedMinutes: number
    nextRunAt?: number
    lastAutomationId?: string
    lastRunAt?: number
}

/** Warm-up state for one profile, or null before its first warm-up run. */
export async function warmupGetByProfile(profileId: string): Promise<DbWarmupState | null> {
    const cleaned = String(profileId || '').trim()
    if (!cleaned) throw new Error('profileId is required')
    return convexFetch<DbWarmupState | null>(`/api/warmup/by-profile?profileId=${encodeURIComponent(cleaned)}`)
}

export async function warmupBeginRun(input: {
    profileId: string
    automationId: string
    runId: string
    minMinutes: number
    maxMinutes: number
    sessionMinMinutes: number
    sessionMaxMinutes: number
    restMinMinutes: number
    restMaxMinutes: number
}): Promise<{ date: string; minutes: number }> {
    return convexFetch('/api/warmup/begin', { method: 'POST', body: input })
}

/** Reduced profile payload returned by runtimeListPageInternal (see toRuntimeProfile). */
export type RuntimeProfile = {
    id: string
    name: string
    status?: string
    using: boolean
    listIds?: string[]
    lastOpenedAt?: number
    igLoggedIn?: boolean
    outreachReady?: boolean
    renameFrom?: string
}

export type RuntimePage = {
    automation?: { status?: string; isActive?: boolean; configRevision?: string }
    profiles: RuntimeProfile[]
    warmups?: Array<{ profileId: string; nextRunAt?: number }>
    progress?: Array<{ profileId: string; nextRunAt?: number }>
    nextCursor?: string | null
    isDone?: boolean
} | null

export async function automationsRuntimePage(
    automationId: string,
    listId: string,
    cursor?: string | null,
): Promise<RuntimePage> {
    const cleaned = String(automationId || '').trim()
    if (!cleaned) throw new Error('automationId is required')
    if (!String(listId || '').trim()) throw new Error('listId is required')
    const params = new URLSearchParams({ automationId: cleaned, listId: String(listId) })
    if (cursor) params.set('cursor', cursor)
    return convexFetch<RuntimePage>(`/api/automations/runtime-page?${params.toString()}`)
}

export const automationsList = () => convexFetch<DbAutomationRow[]>('/api/automations')
export const routineReady = (automationId: string, profileId: string, checkpoint = false) => convexFetch<boolean>('/api/routines/ready', { method: 'POST', body: { automationId, profileId, checkpoint } })
export const routineRecordSession = (automationId: string, profileId: string, activityCompleted: boolean, issue?: string) => convexFetch('/api/routines/session', { method: 'POST', body: { automationId, profileId, activityCompleted, issue } })
export const routineReserve = (automationId: string, profileId: string) => convexFetch<{ leadId: string; username: string; message: string; date: string } | null>('/api/routines/reserve', { method: 'POST', body: { automationId, profileId }, maxRetries: 0 })
// Never retry authorization to send: a lost response must not cause a duplicate delivery.
export const routineBeginSend = (automationId: string, profileId: string, leadId: string, date: string) => convexFetch<boolean>('/api/routines/begin-send', { method: 'POST', body: { automationId, profileId, leadId, date }, maxRetries: 0 })
export const routineFollowTasks = (automationId: string, profileId: string) => convexFetch<Array<{ leadId: string; username: string }>>('/api/routines/follow-tasks', { method: 'POST', body: { automationId, profileId } })
export const routineRecordFollow = (profileId: string, leadId: string, followed: boolean) => convexFetch('/api/routines/record-follow', { method: 'POST', body: { profileId, leadId, followed } })
export const routineFinishSend = (profileId: string, leadId: string, date: string, sent: boolean, blocked = false) => convexFetch('/api/routines/finish-send', { method: 'POST', body: { profileId, leadId, date, sent, blocked } })

export function profilesBeginDelete(name: string): Promise<DbProfileRow | null> {
    return convexFetch('/api/profiles/begin-delete', { method: 'POST', body: { name } });
}

export function profilesFinishDelete(profileId: string): Promise<{ ok: true }> {
    return convexFetch('/api/profiles/finish-delete', { method: 'POST', body: { profileId } });
}

export function profilesFinishRename(profileId: string): Promise<{ ok: true }> {
    return convexFetch('/api/profiles/finish-rename', { method: 'POST', body: { profileId } });
}

export async function warmupFinishRun(input: {
    profileId: string; runId: string; date: string; minutes: number
}): Promise<void> {
    await convexFetch('/api/warmup/finish', { method: 'POST', body: input })
}

export async function warmupList(): Promise<DbWarmupState[]> {
    return convexFetch<DbWarmupState[]>('/api/warmup/states');
}
