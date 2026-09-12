import type { ConvexClient } from './convex.js'

// Instagram account filtering: US male-name allowlist plus gender
// classification. Keywords come from the Convex DB, never local files.

export type KeywordSets = Record<string, Set<string>>

// Female name endings, used as a last resort.
const FEMALE_ENDINGS = new Set([
    'a',
    'ya',
    'ia',
    'ina',
    'ova',
    'eva',
    'skaya',
    'ivna',
    'yivna',
    'ovna',
])

// Special-font characters mapped to standard Latin letters.
const NORMALIZATION_MAP: Record<string, string> = {
    'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f',
    'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l',
    'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ǫ': 'q', 'ʀ': 'r',
    'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'x': 'x',
    'ʏ': 'y', 'ᴢ': 'z',
}

// Parse newline-separated keyword content into a set.
export function parseKeywordContent(content: string): Set<string> {
    const out = new Set<string>()
    for (const line of content.split('\n')) {
        const trimmed = line.trim().toLowerCase()
        if (trimmed && !trimmed.startsWith('#')) out.add(trimmed)
    }
    return out
}

// Load one keyword list from the DB. Missing entries load as empty.
export async function loadKeywords(
    client: ConvexClient,
    filename: string,
    env = 'dev',
): Promise<Set<string>> {
    try {
        const content = await client.getKeyword(filename, env)
        if (content == null) return new Set()
        return parseKeywordContent(content)
    } catch {
        return new Set()
    }
}

// Load every keyword set used for filtering.
export async function loadAllKeywordSets(
    client: ConvexClient,
    env = 'dev',
): Promise<KeywordSets> {
    return {
        us_male_names: await loadKeywords(client, 'us_male_names.txt', env),
    }
}

// English check for display names. The old fasttext model is gone, and
// trigram detectors misclassify short names, so this is script-based:
// names with non-Latin letters (Cyrillic, CJK, ...) are non-English,
// everything else passes. Fail-open, like the old code on model errors.
export function isEnglish(text: string): boolean {
    if (!text || !text.trim()) return true
    for (const ch of text) {
        if (/\p{L}/u.test(ch) && !/^\p{Script=Latin}$/u.test(ch)) {
            return false
        }
    }
    return true
}

// Convert special font characters to standard Latin letters.
export function normalizeText(text: string): string {
    let out = text
    for (const [char, replacement] of Object.entries(NORMALIZATION_MAP)) {
        out = out.split(char).join(replacement)
    }
    return out
}

// Classify a profile with a multi-step priority system.
// Returns 'female' for removal, 'keep' to keep the profile.
export function classifyGender(
    username: string,
    fullname: string,
    keywordSets?: KeywordSets,
): 'female' | 'keep' {
    const combined = `${username} ${fullname}`.toLowerCase()
    if (!combined.trim()) return 'keep'

    const normalized = normalizeText(combined)
    const parts = new Set(
        normalized.replace(/[^a-zа-яёїієґ]+/g, ' ').split(' ').filter(Boolean),
    )

    const femaleBusiness = keywordSets?.female_business_keywords ?? new Set()
    const maleExceptions = keywordSets?.male_names_exceptions ?? new Set()
    const femaleNames = keywordSets?.female_names ?? new Set()

    if ([...femaleBusiness].some((keyword) => parts.has(keyword))) {
        return 'female'
    }
    if ([...maleExceptions].some((name) => parts.has(name))) {
        return 'keep'
    }
    if ([...femaleNames].some((name) => parts.has(name))) {
        return 'female'
    }

    for (const part of parts) {
        if (part.length > 3 && !maleExceptions.has(part)) {
            for (const ending of FEMALE_ENDINGS) {
                if (part.endsWith(ending)) return 'female'
            }
        }
    }
    return 'keep'
}

// Filter a profile with keyword sets (US male names allowlist plus gender
// classification). Returns [action, matchedName].
export function filterWithKeywords(
    username: string,
    fullname: string,
    keywordSets?: KeywordSets,
): ['keep' | 'remove', string | null] {
    if (fullname && !isEnglish(fullname)) {
        return ['remove', null]
    }

    if (!keywordSets) {
        const action =
            classifyGender(username, fullname) === 'female' ? 'remove' : 'keep'
        return [action, null]
    }

    const usMaleNames = keywordSets.us_male_names ?? new Set<string>()
    let matchedName: string | null = null

    if (usMaleNames.size > 0) {
        if (fullname) {
            for (const part of fullname.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ')) {
                if (part && usMaleNames.has(part)) {
                    matchedName = part
                    break
                }
            }
        }
        if (!matchedName && username) {
            for (const part of username.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ')) {
                if (part && usMaleNames.has(part)) {
                    matchedName = part
                    break
                }
            }
        }
        // Allowlist active and nothing matched: remove.
        if (!matchedName) return ['remove', null]
    }

    if (classifyGender(username, fullname, keywordSets) === 'female') {
        return ['remove', null]
    }
    return [
        'keep',
        matchedName ? matchedName.charAt(0).toUpperCase() + matchedName.slice(1) : null,
    ]
}
