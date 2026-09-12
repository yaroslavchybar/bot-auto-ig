// HTTP error with a status code. Handlers throw these; the router turns
// them into `{ detail }` JSON responses, matching the old FastAPI shape
// the frontend already parses.
export class HttpError extends Error {
    readonly status: number

    constructor(status: number, detail: string) {
        super(detail)
        this.status = status
    }
}

export function badRequest(detail: string): HttpError {
    return new HttpError(400, detail)
}

export function notFound(detail: string): HttpError {
    return new HttpError(404, detail)
}

export function unprocessable(detail: string): HttpError {
    return new HttpError(422, detail)
}

export function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

export function errorResponse(err: unknown): Response {
    if (err instanceof HttpError) {
        return jsonResponse({ detail: err.message }, err.status)
    }
    // Unexpected errors may carry paths, URLs, or backend details.
    // Log them server-side and return a fixed client-safe message.
    console.error(
        'Unhandled request error:',
        err instanceof Error ? err.message : err,
    )
    return jsonResponse({ detail: 'Internal server error' }, 500)
}

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Allow-Headers': '*',
}

// Wrap a fetch-style handler with CORS headers and centralized errors.
export function withCors(
    handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
    return async (req: Request) => {
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS })
        }
        let res: Response
        try {
            res = await handler(req)
        } catch (err) {
            res = errorResponse(err)
        }
        const headers = new Headers(res.headers)
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
            headers.set(key, value)
        }
        return new Response(res.body, { status: res.status, headers })
    }
}
