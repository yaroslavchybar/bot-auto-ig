import type { HttpRouter } from 'convex/server';
import { httpAction, type ActionCtx } from '../_generated/server';

// ═══════════════════════════════════════════════════════════════════
// HTTP Error Classes
// ═══════════════════════════════════════════════════════════════════

/** Base error for HTTP actions with a status code. */
export class HttpError extends Error {
  readonly statusCode: number;
  constructor(
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

/** 400 Bad Request — invalid input or missing required fields. */
export class ValidationError extends HttpError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

// ═══════════════════════════════════════════════════════════════════
// Error Categorization
// ═══════════════════════════════════════════════════════════════════

function categorizeError(err: unknown): { message: string; status: number } {
  if (err instanceof HttpError) return { message: err.message, status: err.statusCode };
  const data = err && typeof err === 'object' && 'data' in err ? err.data : null;
  if (data && typeof data === 'object' && 'code' in data && 'message' in data) {
    const statuses: Record<string, number> = { NOT_FOUND: 404, CONFLICT: 409, VALIDATION: 400 };
    return { message: String(data.message), status: statuses[String(data.code)] ?? 500 };
  }
  return { message: err instanceof Error ? err.message : 'Internal error', status: 500 };
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('JSON object is required');
    return body as Record<string, any>;
  } catch {
    throw new ValidationError('Invalid JSON object');
  }
}

export function mapProfileToApi(
  profile: import('../_generated/dataModel').Doc<'profiles'> | null,
  optionsOrIndex?: { includeCookies?: boolean } | number,
) {
  if (!profile) return null;
  const { _id, _creationTime, cookiesJson, ...fields } = profile;
  const includeCookies = typeof optionsOrIndex === 'object' && optionsOrIndex.includeCookies;
  return { ...fields, id: _id, ...(includeCookies ? { cookiesJson } : {}) };
}

export function mapAccountToApi(account: any): any {
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

export function mapListToApi(list: any): any {
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
