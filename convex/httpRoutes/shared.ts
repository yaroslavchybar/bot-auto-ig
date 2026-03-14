import type { HttpRouter } from 'convex/server';
import { httpAction } from '../_generated/server';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function getInternalApiKey(): string | null {
  const token = (globalThis as any)?.process?.env?.INTERNAL_API_KEY as string | undefined;
  const cleaned = typeof token === 'string' ? token.trim() : '';
  return cleaned || null;
}

export async function requireAuth(request: Request): Promise<Response | null> {
  const token = getInternalApiKey();
  if (!token) {
    return jsonResponse({ error: 'Internal API key is not configured' }, 500);
  }
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${token}`) return jsonResponse({ error: 'Unauthorized' }, 401);
  return null;
}

export function toIso(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export async function parseBody(request: Request): Promise<Record<string, any>> {
  try {
    const body = await request.json();
    return body as Record<string, any>;
  } catch {
    return {};
  }
}

export function mapProfileToPython(
  profile: any,
  optionsOrIndex?: { includeCookies?: boolean } | number,
): any {
  if (!profile) return profile;
  const options =
    optionsOrIndex && typeof optionsOrIndex === 'object' && !Array.isArray(optionsOrIndex)
      ? optionsOrIndex
      : undefined;
  const listIds = Array.isArray(profile.listIds)
    ? profile.listIds.filter((id: unknown) => Boolean(id))
    : [];
  const mapped: Record<string, unknown> = {
    profile_id: profile._id,
    created_at: toIso(profile.createdAt),
    name: profile.name,
    proxy: profile.proxy ?? null,
    proxy_type: profile.proxyType ?? null,
    status: profile.status ?? null,
    mode: profile.mode ?? null,
    session_id: typeof profile.sessionId === 'string' ? profile.sessionId : null,
    Using: Boolean(profile.using),
    test_ip: Boolean(profile.testIp),
    fingerprint_seed: profile.fingerprintSeed ?? null,
    fingerprint_os: profile.fingerprintOs ?? null,
    list_ids: listIds,
    last_opened_at: toIso(profile.lastOpenedAt),
    login: Boolean(profile.login),
    daily_scraping_limit:
      typeof profile.dailyScrapingLimit === 'number' ? profile.dailyScrapingLimit : null,
    daily_scraping_used:
      typeof profile.dailyScrapingUsed === 'number' ? profile.dailyScrapingUsed : 0,
    scrape_lease_owner:
      typeof profile.scrapeLeaseOwner === 'string' ? profile.scrapeLeaseOwner : null,
    scrape_lease_expires_at: toIso(profile.scrapeLeaseExpiresAt),
    scrape_health: typeof profile.scrapeHealth === 'number' ? profile.scrapeHealth : 100,
    last_scrape_failure_at: toIso(profile.lastScrapeFailureAt),
  };
  if (options?.includeCookies) {
    mapped.cookies_json = typeof profile.cookiesJson === 'string' ? profile.cookiesJson : null;
  }
  return mapped;
}

export function mapAccountToPython(account: any): any {
  if (!account) return account;
  return {
    id: account._id,
    user_name: account.userName,
    full_name: account.fullName ?? null,
    matched_name: account.matchedName ?? null,
    assigned_to: account.assignedTo ?? null,
    status: account.status ?? null,
    message: Boolean(account.message),
    subscribed_at: toIso(account.subscribedAt),
    last_messaged_at: toIso(account.lastMessagedAt),
    created_at: toIso(account.createdAt),
  };
}

export function mapListToPython(list: any): any {
  if (!list) return list;
  return {
    id: list._id,
    name: list.name,
  };
}

export const corsPreflightHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
});

/** Register OPTIONS preflight handlers for an array of paths. */
export function registerPreflight(http: HttpRouter, paths: string[]): void {
  for (const path of paths) {
    http.route({ path, method: 'OPTIONS', handler: corsPreflightHandler });
  }
}
