import type { Page } from 'playwright-core'

// TS port of the igscrape likers path (server/scraper.go fetchViaRest):
// GET /api/v1/media/{id}/likers/?count=100&max_id={cursor}.
// Runs inside page.evaluate so cookies, proxy, TLS and fingerprint stay
// identical to the warmed-up browser session. No separate login needed.

export type LikerUser = {
    pk?: string | number
    id?: string
    username?: string
    full_name?: string
    is_verified?: boolean
    is_private?: boolean
}

export type PostRef = {
    // Numeric media pk used by the API.
    mediaPk: string
    // Canonical post URL opened in the browser before scraping.
    postUrl: string
}

export const WEB_APP_ID = '936619743392459'
export const WEB_ASBD_ID = '129477'

// Same alphabet as instagrapi InstagramIdCodec.
const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

// Decode a shortcode to its numeric media pk (first 11 chars carry the id).
// Media pks exceed float precision, so decoding uses BigInt.
export function mediaPkFromShortcode(shortcode: string): string {
    const code = String(shortcode || '').slice(0, 11)
    const base = BigInt(SHORTCODE_ALPHABET.length)
    let num = 0n
    for (const char of code) {
        const index = SHORTCODE_ALPHABET.indexOf(char)
        if (index < 0) throw new Error('Invalid post shortcode')
        num = num * base + BigInt(index)
    }
    if (num <= 0n) throw new Error('Invalid post shortcode')
    return String(num)
}

// Accept a full post URL, a bare shortcode, or a numeric media id.
// Returns null when the value is not a recognizable post reference.
export function parsePostInput(value: unknown): PostRef | null {
    const raw = String(value ?? '').trim()
    if (!raw) return null
    if (/^\d+$/.test(raw)) {
        return { mediaPk: raw, postUrl: `https://www.instagram.com/p/${raw}/` }
    }
    const urlMatch = raw.match(
        /instagram\.com\/(?:[a-zA-Z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9-_]+)/,
    )
    const code = urlMatch ? urlMatch[2] : raw
    if (!/^[A-Za-z0-9-_]{6,}$/.test(code)) return null
    try {
        const mediaPk = mediaPkFromShortcode(code)
        return { mediaPk, postUrl: `https://www.instagram.com/p/${code}/` }
    } catch {
        return null
    }
}

// Fixed fetch window. Mirrors igscrape fetchViaRest: small counts return a
// single page with no cursor, cutting big posts short; 100 is the proven
// window and still paginates via max_id when more likers exist.
export const LIKERS_PAGE_SIZE = 100

export type LikersPage = {
    users: LikerUser[]
    cursor: string | null
}

// One likers page. Mirrors igscrape fetchViaRest: same endpoint, same
// count=100 window, same max_id cursor, same strict response validation.
// Runs inside page.evaluate so cookies, proxy, TLS and fingerprint stay
// identical to the warmed-up browser session: User-Agent, Accept-Language,
// Referer and Cookie all come from the browser automatically (fetch forbids
// setting Referer/Cookie headers by hand), which is why only the IG app
// headers are set explicitly. No session cookies leave the browser.
export async function fetchMediaLikersPage(
    page: Page,
    mediaPk: string,
    cursor: string | null,
): Promise<LikersPage> {
    const result = await page.evaluate(
        async ({ mediaPk, cursor }) => {
            const headers: Record<string, string> = {
                'x-ig-app-id': '936619743392459',
                'x-asbd-id': '129477',
                'x-requested-with': 'XMLHttpRequest',
            }
            const csrf = document.cookie
                .split('; ')
                .find((part) => part.startsWith('csrftoken='))
                ?.slice(10)
            if (csrf) headers['x-csrftoken'] = decodeURIComponent(csrf)
            const params = new URLSearchParams({ count: String(100) })
            if (cursor) params.set('max_id', cursor)
            const response = await fetch(
                `/api/v1/media/${encodeURIComponent(mediaPk)}/likers/?${params}`,
                {
                    headers,
                    credentials: 'include',
                    signal: AbortSignal.timeout(8_000),
                },
            )
            if (!response.ok) {
                if (response.status === 401 || response.status === 403)
                    throw new Error(`Instagram login required (HTTP ${response.status})`)
                if (response.status === 404) throw new Error('Post not found')
                if (response.status === 429)
                    throw new Error('Instagram throttled the scrape (HTTP 429)')
                throw new Error(`Instagram HTTP ${response.status}`)
            }
            // Instagram redirects dead sessions to the login page instead of
            // 401ing; fetch follows the redirect, so a non-JSON body means
            // the session is gone (mirrors the HTTP 302 check in Go).
            const contentType = response.headers.get('content-type') || ''
            if (!contentType.includes('json'))
                throw new Error('Instagram login required (session expired or redirected to login)')
            const text = await response.text()
            if (text.length > 10 << 20)
                throw new Error('Instagram likers response exceeds size limit')
            let body: {
                status?: string
                users?: unknown
                next_max_id?: string | number | null
            }
            try {
                // JSON.parse rejects trailing garbage, same as the Go decoder check.
                body = JSON.parse(text)
            } catch {
                throw new Error('Received non-JSON response from Instagram API')
            }
            if ((body.status !== undefined && body.status !== 'ok') || !Array.isArray(body.users))
                throw new Error('Instagram returned an unsuccessful or incomplete likers response')
            return {
                users: body.users as Array<Record<string, unknown>>,
                cursor:
                    body.next_max_id == null || body.next_max_id === ''
                        ? null
                        : String(body.next_max_id) || null,
            }
        },
        { mediaPk, cursor },
    )
    return result as LikersPage
}
