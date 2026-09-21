/**
 * Authenticate calls made by the trusted application server.
 * NOTE: the token travels in query args, so it can appear in Convex query
 * logs. Accepted pragmatically — server-only queries, rotatable via env.
 */
export function requireServerBridgeAuth(token: string): void {
  const expected = (globalThis as any)?.process?.env?.INTERNAL_API_KEY;
  if (typeof expected !== "string" || !expected.trim() || token !== expected.trim()) {
    throw new Error("Unauthorized");
  }
}
