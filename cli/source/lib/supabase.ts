import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (two levels up from cli/source/lib)
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');

function requireSupabaseConfig() {
	if (!supabaseUrl || !supabaseKey) {
		throw new Error('Supabase config missing. Set SUPABASE_URL and SUPABASE_SECRET_KEY in environment.');
	}
}

export type DbListRow = {id: string; name: string};

export type DbProfileRow = {
	profile_id: string;
	created_at?: string;
	name: string;
	proxy?: string | null;
	proxy_type?: string | null;
	status?: string | null;
	mode?: string | null;
	Using: boolean;
	type?: string | null;
	test_ip: boolean;
	user_agent?: string | null;
	list_id?: string | null;
	sessions_today?: number | null;
	last_opened_at?: string | null;
	ua_os?: string | null;
	ua_browser?: string | null;
	login: boolean;
};

export async function listsList(): Promise<DbListRow[]> {
	requireSupabaseConfig();
	const {data, error} = await supabase.from('lists').select('id,name').order('created_at', {ascending: true});
	if (error) throw new Error(error.message);
	return (data || []) as DbListRow[];
}

export async function listsCreate(name: string): Promise<DbListRow | null> {
	requireSupabaseConfig();
	const cleaned = String(name || '').trim();
	if (!cleaned) throw new Error('name is required');
	const {data, error} = await supabase.from('lists').insert({name: cleaned}).select('id,name');
	if (error) throw new Error(error.message);
	return (Array.isArray(data) && data.length > 0 ? (data[0] as DbListRow) : null) as DbListRow | null;
}

export async function listsUpdate(id: string, name: string): Promise<DbListRow | null> {
	requireSupabaseConfig();
	const listId = String(id || '').trim();
	const cleaned = String(name || '').trim();
	if (!listId || !cleaned) throw new Error('id and name are required');
	const {data, error} = await supabase.from('lists').update({name: cleaned}).eq('id', listId).select('id,name');
	if (error) throw new Error(error.message);
	return (Array.isArray(data) && data.length > 0 ? (data[0] as DbListRow) : null) as DbListRow | null;
}

export async function listsDelete(id: string): Promise<true> {
	requireSupabaseConfig();
	const listId = String(id || '').trim();
	if (!listId) throw new Error('id is required');
	const {error} = await supabase.from('lists').delete().eq('id', listId);
	if (error) throw new Error(error.message);
	return true;
}

export async function profilesList(): Promise<DbProfileRow[]> {
	requireSupabaseConfig();
	const {data, error} = await supabase.from('profiles').select('*');
	if (error) throw new Error(error.message);
	return (data || []) as DbProfileRow[];
}

function computeProfileMode(proxy: unknown): 'proxy' | 'direct' {
	const s = typeof proxy === 'string' ? proxy.trim() : '';
	return s ? 'proxy' : 'direct';
}

export type ProfileInput = {
	name: string;
	proxy?: string;
	proxy_type?: string;
	type?: string;
	test_ip?: boolean;
	user_agent?: string;
	ua_os?: string;
	ua_browser?: string;
};

export async function profilesCreate(profile: ProfileInput): Promise<DbProfileRow | null> {
	requireSupabaseConfig();
	const name = String(profile?.name || '').trim();
	if (!name) throw new Error('name is required');
	const proxy = typeof profile?.proxy === 'string' ? profile.proxy : undefined;
	const dbData: Partial<DbProfileRow> & {name: string; test_ip: boolean; Using: boolean; mode: string; status: string} = {
		name,
		proxy: proxy ?? null,
		proxy_type: profile?.proxy_type ?? null,
		type: profile?.type ?? 'Camoufox (рекомендуется)',
		test_ip: profile?.test_ip ?? false,
		user_agent: profile?.user_agent ?? null,
		ua_os: profile?.ua_os ?? null,
		ua_browser: profile?.ua_browser ?? null,
		mode: computeProfileMode(proxy),
		status: 'idle',
		Using: false,
	};
	const {data, error} = await supabase.from('profiles').insert(dbData).select('*');
	if (error) throw new Error(error.message);
	return (Array.isArray(data) && data.length > 0 ? (data[0] as DbProfileRow) : null) as DbProfileRow | null;
}

export async function profilesUpdateByName(oldName: string, profile: ProfileInput): Promise<DbProfileRow | null> {
	requireSupabaseConfig();
	const oldClean = String(oldName || '').trim();
	if (!oldClean) throw new Error('old_name is required');
	const {data: existing, error: existingError} = await supabase
		.from('profiles')
		.select('profile_id')
		.eq('name', oldClean)
		.limit(1)
		.maybeSingle();
	if (existingError) throw new Error(existingError.message);
	if (!existing?.profile_id) throw new Error('Profile not found');

	const name = String(profile?.name || '').trim();
	if (!name) throw new Error('name is required');
	const proxy = typeof profile?.proxy === 'string' ? profile.proxy : undefined;
	const dbData: Partial<DbProfileRow> & {name: string; test_ip: boolean; mode: string} = {
		name,
		proxy: proxy ?? null,
		proxy_type: profile?.proxy_type ?? null,
		type: profile?.type ?? 'Camoufox (рекомендуется)',
		test_ip: profile?.test_ip ?? false,
		user_agent: profile?.user_agent ?? null,
		ua_os: profile?.ua_os ?? null,
		ua_browser: profile?.ua_browser ?? null,
		mode: computeProfileMode(proxy),
	};

	const {data, error} = await supabase.from('profiles').update(dbData).eq('profile_id', existing.profile_id).select('*');
	if (error) throw new Error(error.message);
	return (Array.isArray(data) && data.length > 0 ? (data[0] as DbProfileRow) : null) as DbProfileRow | null;
}

export async function profilesDeleteByName(name: string): Promise<true> {
	requireSupabaseConfig();
	const cleaned = String(name || '').trim();
	if (!cleaned) throw new Error('name is required');
	const {data: existing, error: existingError} = await supabase
		.from('profiles')
		.select('profile_id')
		.eq('name', cleaned)
		.limit(1)
		.maybeSingle();
	if (existingError) throw new Error(existingError.message);
	if (!existing?.profile_id) return true;
	const {error} = await supabase.from('profiles').delete().eq('profile_id', existing.profile_id);
	if (error) throw new Error(error.message);
	return true;
}

export async function profilesSyncStatus(name: string, status: string, using: boolean = false): Promise<true> {
	requireSupabaseConfig();
	const cleanedName = String(name || '').trim();
	const cleanedStatus = String(status || '').trim();
	if (!cleanedName || !cleanedStatus) throw new Error('name and status are required');
	const {data: existing, error: existingError} = await supabase
		.from('profiles')
		.select('profile_id')
		.eq('name', cleanedName)
		.limit(1)
		.maybeSingle();
	if (existingError) throw new Error(existingError.message);
	if (!existing?.profile_id) return true;
	const next: Record<string, any> = {status: cleanedStatus, Using: Boolean(using)};
	if (cleanedStatus.toLowerCase() === 'running') {
		next.last_opened_at = new Date().toISOString();
	}
	const {error} = await supabase.from('profiles').update(next).eq('profile_id', existing.profile_id);
	if (error) throw new Error(error.message);
	return true;
}

export async function profilesSetLoginTrue(name: string): Promise<true> {
	requireSupabaseConfig();
	const cleanedName = String(name || '').trim();
	if (!cleanedName) throw new Error('name is required');
	const {data: existing, error: existingError} = await supabase
		.from('profiles')
		.select('profile_id')
		.eq('name', cleanedName)
		.limit(1)
		.maybeSingle();
	if (existingError) throw new Error(existingError.message);
	if (!existing?.profile_id) return true;
	const {error} = await supabase.from('profiles').update({login: true}).eq('profile_id', existing.profile_id);
	if (error) throw new Error(error.message);
	return true;
}

export async function profilesListAssigned(listId: string): Promise<Array<Pick<DbProfileRow, 'profile_id' | 'name'>>> {
	requireSupabaseConfig();
	const cleaned = String(listId || '').trim();
	if (!cleaned) throw new Error('list_id is required');
	const {data, error} = await supabase
		.from('profiles')
		.select('profile_id,name')
		.eq('list_id', cleaned)
		.eq('login', true)
		.order('created_at', {ascending: true});
	if (error) throw new Error(error.message);
	return (data || []) as Array<Pick<DbProfileRow, 'profile_id' | 'name'>>;
}

export async function profilesListUnassigned(): Promise<Array<Pick<DbProfileRow, 'profile_id' | 'name'>>> {
	requireSupabaseConfig();
	const {data, error} = await supabase
		.from('profiles')
		.select('profile_id,name')
		.is('list_id', null)
		.eq('login', true)
		.order('created_at', {ascending: true});
	if (error) throw new Error(error.message);
	return (data || []) as Array<Pick<DbProfileRow, 'profile_id' | 'name'>>;
}

export async function profilesBulkSetListId(profileIds: string[], listId: string | null): Promise<true> {
	requireSupabaseConfig();
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	if (typeof listId === 'undefined') throw new Error('list_id is required (use null to unassign)');
	const cleanedIds = profileIds.map(v => String(v || '').trim()).filter(Boolean);
	if (cleanedIds.length === 0) return true;
	const {error} = await supabase.from('profiles').update({list_id: listId}).in('profile_id', cleanedIds);
	if (error) throw new Error(error.message);
	return true;
}

export async function profilesClearBusyForLists(listIds: string[]): Promise<true> {
	requireSupabaseConfig();
	if (!Array.isArray(listIds) || listIds.length === 0) return true;
	const cleanedListIds = listIds.map(v => String(v || '').trim()).filter(Boolean);
	if (cleanedListIds.length === 0) return true;

	const {data, error} = await supabase
		.from('profiles')
		.select('profile_id,status,Using')
		.in('list_id', cleanedListIds)
		.order('created_at', {ascending: true});
	if (error) throw new Error(error.message);
	const rows = (data || []) as Array<Pick<DbProfileRow, 'profile_id' | 'status' | 'Using'>>;
	const toUpdate = rows
		.filter(r => (String(r.status || '').toLowerCase() === 'running' ? true : Boolean(r.Using)))
		.map(r => r.profile_id)
		.filter(Boolean);
	if (toUpdate.length === 0) return true;

	const results = await Promise.allSettled(
		toUpdate.map(profileId => supabase.from('profiles').update({status: 'idle', Using: false}).eq('profile_id', profileId)),
	);
	void results;
	return true;
}

export async function instagramSettingsGet(scope: string = 'global'): Promise<Record<string, any> | null> {
	requireSupabaseConfig();
	const cleaned = String(scope || 'global');
	const {data, error} = await supabase.from('instagram_settings').select('data').eq('scope', cleaned).limit(1).maybeSingle();
	if (error) throw new Error(error.message);
	const value = (data as any)?.data;
	return value && typeof value === 'object' ? (value as Record<string, any>) : null;
}

export async function instagramSettingsUpsert(scope: string, data: Record<string, any>): Promise<Record<string, any> | null> {
	requireSupabaseConfig();
	const cleanedScope = String(scope || '').trim() || 'global';
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be an object');
	const payload = {scope: cleanedScope, data, updated_at: new Date().toISOString()};
	const {data: rows, error} = await supabase
		.from('instagram_settings')
		.upsert(payload, {onConflict: 'scope'})
		.select('data')
		.limit(1);
	if (error) throw new Error(error.message);
	const value = Array.isArray(rows) && rows.length > 0 ? (rows[0] as any)?.data : null;
	return value && typeof value === 'object' ? (value as Record<string, any>) : null;
}

export async function messageTemplatesGet(kind: string): Promise<string[]> {
	requireSupabaseConfig();
	const cleaned = String(kind || '').trim();
	if (!cleaned) throw new Error('kind is required');
	const {data, error} = await supabase.from('message_templates').select('texts').eq('kind', cleaned).limit(1).maybeSingle();
	if (error) throw new Error(error.message);
	const texts = (data as any)?.texts;
	if (!Array.isArray(texts)) return [];
	return texts.map(t => String(t)).filter(t => t.trim());
}

export async function messageTemplatesUpsert(kind: string, texts: string[]): Promise<true> {
	requireSupabaseConfig();
	const cleanedKind = String(kind || '').trim();
	if (!cleanedKind) throw new Error('kind is required');
	if (!Array.isArray(texts)) throw new Error('texts must be a list');
	const cleanedTexts = texts.map(t => String(t)).filter(t => t.trim());
	const {error} = await supabase
		.from('message_templates')
		.upsert({kind: cleanedKind, texts: cleanedTexts}, {onConflict: 'kind'});
	if (error) throw new Error(error.message);
	return true;
}
