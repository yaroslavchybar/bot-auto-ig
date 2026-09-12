import path from 'node:path'
import { getConvexUrl, getInternalApiKey } from './convex.js'

function defaultUploadDir(): string {
    return path.join(process.cwd(), 'uploads')
}

function parsePort(): number {
    const raw = (process.env.PORT ?? '3002').trim()
    if (!/^\d+$/.test(raw)) {
        throw new Error(`Invalid PORT ${JSON.stringify(process.env.PORT ?? '')}: expected a port number 1-65535`)
    }
    const port = Number(raw)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid PORT ${JSON.stringify(process.env.PORT ?? '')}: expected a port number 1-65535`)
    }
    return port
}

// Fail fast at startup: a bad port or missing Convex settings must crash
// with a clear message instead of serving half-broken requests.
const port = parsePort()
getConvexUrl('dev')
getInternalApiKey()

// Runtime configuration, read from the environment.
// CONVEX_URL_DEV (falling back to CONVEX_URL) and INTERNAL_API_KEY are
// required; PORT and UPLOAD_DIR have local defaults.
export const config = {
    port,
    uploadDir: process.env.UPLOAD_DIR ?? defaultUploadDir(),
}
