import type { HttpRouter } from 'convex/server';
import { httpAction, type ActionCtx } from '../_generated/server';

// ═══════════════════════════════════════════════════════════════════
// HTTP Error Classes
// ═══════════════════════════════════════════════════════════════════

/** Base error for HTTP actions with a status code. */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** 400 Bad Request — invalid input or missing required fields. */
export class ValidationError extends HttpError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

/** 404 Not Found — requested resource does not exist. */
export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

/** 409 Conflict — operation conflicts with current resource state. */
export class ConflictError extends HttpError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

// ═══════════════════════════════════════════════════════════════════
// Error Categorization
// ═══════════════════════════════════════════════════════════════════

const NOT_FOUND_PATTERNS = [
  'not found',
  'does not exist',
  'no such',
];

const CONFLICT_PATTERNS = [
  'already running',
  'already finished',
  'cannot update running',
  'cannot delete running',
  'cannot reset running',
  'can only pause running',
  'can only resume paused',
  'can only retry failed',
  'daily run limit',
  'maximum retries',
];

const VALIDATION_PATTERNS = [
  'required',
  'invalid',
  'must be',
  'cannot be empty',
  'too long',
  'too short',
];

function categorizeError(err: unknown): { message: string; status: number } {
  if (err instanceof HttpError) {
    return { message: err.message, status: err.statusCode };
  }

  const message = String((err as any)?.message || err);
  const lower = message.toLowerCase();

  if (NOT_FOUND_PATTERNS.some((p) => lower.includes(p))) {
    return { message, status: 404 };
  }
  if (CONFLICT_PATTERNS.some((p) => lower.includes(p))) {
    return { message, status: 409 };
  }
  if (VALIDATION_PATTERNS.some((p) => lower.includes(p))) {
    return { message, status: 400 };
  }

  return { message, status: 500 };
}

// ═══════════════════════════════════════════════════════════════════
// Handler Wrapper
// ═══════════════════════════════════════════════════════════════════

type HandlerFn = (ctx: ActionCtx, request: Request) => Promise<Response>;

/**
 * Wraps an HTTP action handler with auth check and error handling.
 * Replaces inline try/catch + requireAuth boilerplate.
 */
export function withErrorHandling(handler: HandlerFn) {
  return httpAction(async (ctx, request) => {
    const authError = await requireAuth(request);
    if (authError) return authError;
    try {
      return await handler(ctx, request);
    } catch (err: unknown) {
      const { message, status } = categorizeError(err);
      return jsonResponse({ error: message }, status);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// Response & Auth Helpers
// ═══════════════════════════════════════════════════════════════════

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

export const BULK_INSERT_BATCH_SIZE = 500;

export function chunkArray<T>(items: T[], chunkSize: number = BULK_INSERT_BATCH_SIZE): T[][] {
  const safeChunkSize = Math.max(1, Math.floor(chunkSize || BULK_INSERT_BATCH_SIZE));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += safeChunkSize) {
    chunks.push(items.slice(index, index + safeChunkSize));
  }
  return chunks;
}

export function formatChunkFailureMessage(args: {
  operation: string;
  inserted: number;
  skipped: number;
  completedBatches: number;
  totalBatches: number;
  error: unknown;
}): string {
  const errorMessage =
    args.error instanceof Error ? args.error.message : String(args.error ?? 'Unknown error');
  return `${args.operation} failed after ${args.completedBatches}/${args.totalBatches} batches; partial progress inserted=${args.inserted}, skipped=${args.skipped}. ${errorMessage}`;
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
    assigned_accounts_limit:
      typeof profile.assignedAccountsLimit === 'number' ? profile.assignedAccountsLimit : 10,
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
