/**
 * Convex client for TypeScript using HTTP API.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const convexCloudUrl = process.env.CONVEX_URL;
const convexApiKey = process.env.CONVEX_API_KEY || process.env.CONVEX_HTTP_BEARER_TOKEN;

if (!convexCloudUrl) {
    throw new Error('Convex config missing. Set CONVEX_URL in environment.');
}

// HTTP Actions are served at .convex.site, not .convex.cloud
// Convert the URL if needed
const convexUrl = convexCloudUrl.replace('.convex.cloud', '.convex.site');

// Database types
export type DbListRow = { id: string; name: string };

export type DbProfileRow = {
    profile_id: string;
    created_at?: string;
    name: string;
    proxy?: string | null;
    proxy_type?: string | null;
    automation?: boolean | null;
    status?: string | null;
    mode?: string | null;
    session_id?: string | null;
    Using: boolean;
    test_ip: boolean;
    fingerprint_seed?: string | null;
    fingerprint_os?: string | null;
    list_id?: string | null;
    sessions_today?: number | null;
    last_opened_at?: string | null;
    login: boolean;
};

export type ProfileInput = {
    name: string;
    proxy?: string;
    proxy_type?: string;
    fingerprint_seed?: string;
    fingerprint_os?: string;
    test_ip?: boolean;
    automation?: boolean;
};

// HTTP client for Convex
async function convexFetch<T>(endpoint: string, options: { method?: string; body?: any } = {}): Promise<T> {
    const url = `${convexUrl}${endpoint}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
    if (convexApiKey) {
        headers['Authorization'] = `Bearer ${convexApiKey}`;
    }
    const resp = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Convex HTTP error ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
}

// ==================== LISTS ====================

export async function listsList(): Promise<DbListRow[]> {
    return convexFetch<DbListRow[]>('/api/lists');
}

export async function listsCreate(name: string): Promise<DbListRow | null> {
    const cleaned = String(name || '').trim();
    if (!cleaned) throw new Error('name is required');
    return convexFetch<DbListRow | null>('/api/lists', { method: 'POST', body: { name: cleaned } });
}

export async function listsUpdate(id: string, name: string): Promise<DbListRow | null> {
    const listId = String(id || '').trim();
    const cleaned = String(name || '').trim();
    if (!listId || !cleaned) throw new Error('id and name are required');
    return convexFetch<DbListRow | null>('/api/lists/update', { method: 'POST', body: { id: listId, name: cleaned } });
}

export async function listsDelete(id: string): Promise<true> {
    const listId = String(id || '').trim();
    if (!listId) throw new Error('id is required');
    await convexFetch<any>('/api/lists/delete', { method: 'POST', body: { id: listId } });
    return true;
}

// ==================== PROFILES ====================

export async function profilesList(): Promise<DbProfileRow[]> {
    return convexFetch<DbProfileRow[]>('/api/profiles');
}

export async function profilesGetById(profileId: string): Promise<DbProfileRow | null> {
    const cleaned = String(profileId || '').trim();
    if (!cleaned) throw new Error('profile_id is required');
    return convexFetch<DbProfileRow | null>(`/api/profiles/by-id?profileId=${encodeURIComponent(cleaned)}`);
}

export async function profilesCreate(profile: ProfileInput): Promise<DbProfileRow | null> {
    const name = String(profile?.name || '').trim();
    if (!name) throw new Error('name is required');
    return convexFetch<DbProfileRow | null>('/api/profiles', {
        method: 'POST',
        body: {
            name,
            proxy: profile.proxy,
            proxyType: profile.proxy_type,
            fingerprintSeed: profile.fingerprint_seed,
            fingerprintOs: profile.fingerprint_os,
            testIp: profile.test_ip,
            automation: profile.automation,
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
            proxyType: profile.proxy_type,
            fingerprintSeed: profile.fingerprint_seed,
            fingerprintOs: profile.fingerprint_os,
            testIp: profile.test_ip,
            automation: profile.automation,
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

export async function profilesListAssigned(listId: string): Promise<Array<Pick<DbProfileRow, 'profile_id' | 'name'>>> {
    const cleaned = String(listId || '').trim();
    if (!cleaned) throw new Error('list_id is required');
    return convexFetch<Array<Pick<DbProfileRow, 'profile_id' | 'name'>>>(`/api/profiles/assigned?list_id=${encodeURIComponent(cleaned)}`);
}

export async function profilesListUnassigned(): Promise<Array<Pick<DbProfileRow, 'profile_id' | 'name'>>> {
    return convexFetch<Array<Pick<DbProfileRow, 'profile_id' | 'name'>>>('/api/profiles/unassigned');
}

export async function profilesBulkSetListId(profileIds: string[], listId: string | null): Promise<true> {
    if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
    if (typeof listId === 'undefined') throw new Error('list_id is required (use null to unassign)');
    const cleanedIds = profileIds.map(v => String(v || '').trim()).filter(Boolean);
    if (cleanedIds.length === 0) return true;
    await convexFetch<any>('/api/profiles/bulk-set-list-id', {
        method: 'POST',
        body: { profileIds: cleanedIds, listId },
    });
    return true;
}

export async function profilesClearBusyForLists(listIds: string[]): Promise<true> {
    if (!Array.isArray(listIds) || listIds.length === 0) return true;
    const cleanedListIds = listIds.map(v => String(v || '').trim()).filter(Boolean);
    if (cleanedListIds.length === 0) return true;
    await convexFetch<any>('/api/profiles/clear-busy-for-lists', { method: 'POST', body: { listIds: cleanedListIds } });
    return true;
}

// ==================== INSTAGRAM SETTINGS ====================

export async function instagramSettingsGet(scope: string = 'global'): Promise<Record<string, any> | null> {
    const cleaned = String(scope || 'global');
    return convexFetch<Record<string, any> | null>(`/api/instagram-settings?scope=${encodeURIComponent(cleaned)}`);
}

export async function instagramSettingsUpsert(scope: string, data: Record<string, any>): Promise<Record<string, any> | null> {
    const cleanedScope = String(scope || '').trim() || 'global';
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be an object');
    return convexFetch<Record<string, any> | null>('/api/instagram-settings', { method: 'POST', body: { scope: cleanedScope, data } });
}

// ==================== MESSAGE TEMPLATES ====================

export async function messageTemplatesGet(kind: string): Promise<string[]> {
    const cleaned = String(kind || '').trim();
    if (!cleaned) throw new Error('kind is required');
    const result = await convexFetch<string[] | null>(`/api/message-templates?kind=${encodeURIComponent(cleaned)}`);
    return Array.isArray(result) ? result : [];
}

export async function messageTemplatesUpsert(kind: string, texts: string[]): Promise<true> {
    const cleanedKind = String(kind || '').trim();
    if (!cleanedKind) throw new Error('kind is required');
    if (!Array.isArray(texts)) throw new Error('texts must be a list');
    const cleanedTexts = texts.map(t => String(t)).filter(t => t.trim());
    await convexFetch<any>('/api/message-templates', { method: 'POST', body: { kind: cleanedKind, texts: cleanedTexts } });
    return true;
}
