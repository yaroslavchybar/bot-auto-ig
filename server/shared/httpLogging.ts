import { sanitizeLogValue } from './loggingSanitize.js';
import { REQUEST_ID_PATTERN } from './loggingTypes.js';

const contexts = new WeakMap<Request, Record<string, unknown>>();

/** Keep business identifiers only. HTTP payloads may contain passwords and session cookies. */
export function addRequestContext(request: Request, body: Record<string, unknown>): void {
  const context = contexts.get(request);
  if (!context) return;
  for (const key of ['profileId', 'automationId', 'jobId', 'runId', 'leadId', 'accountId', 'modelId', 'listId', 'operation', 'status', 'contentKind', 'sourceId']) {
    if (typeof body[key] === 'string' && body[key].length <= 128) context[key] = body[key];
  }
  for (const key of ['queueWaitMs', 'outputCount', 'failureCount']) {
    if (typeof body[key] === 'number' && Number.isFinite(body[key])) context[key] = body[key];
  }
}

/** Portable HTTP completion logger for runtimes without the API's Pino/AsyncLocalStorage stack. */
export function startRequestLog(request: Request, service = 'convex') {
  const startedAt = Date.now();
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
  const fields: Record<string, unknown> = { method: request.method, path: new URL(request.url).pathname };
  contexts.set(request, fields);
  let finished = false;
  return {
    requestId,
    finish(statusCode: number, error?: unknown, failed = false) {
      if (finished) return;
      finished = true;
      contexts.delete(request);
      const env = process.env;
      const secrets = Object.entries(env).filter(([key, value]) => /password|secret|token|api.?key|private.?key/i.test(key) && value)
        .map(([, value]) => value!);
      const outcome = failed || statusCode >= 500 ? 'error' : statusCode >= 400 ? 'rejected' : 'success';
      const { profileId, automationId, jobId, ...context } = fields;
      const entry = sanitizeLogValue({ id: crypto.randomUUID(), ts: Date.now(), event: 'http.request',
        message: 'http request', source: service, level: outcome === 'error' ? 'error' : 'info',
        requestId, outcome, durationMs: Date.now() - startedAt, profileId, automationId, jobId, error,
        environment: { service, version: env.SERVICE_VERSION || '1.0.0',
          commitHash: env.COMMIT_SHA || 'unknown', region: env.REGION || 'unknown',
          instanceId: env.INSTANCE_ID || env.CONVEX_CLOUD_URL || service, runtime: service, nodeEnv: env.NODE_ENV || 'production' },
        context: { ...context, statusCode },
      }, secrets);
      if (outcome === 'error') console.error(JSON.stringify(entry));
      else console.info(JSON.stringify(entry));
    },
  };
}
