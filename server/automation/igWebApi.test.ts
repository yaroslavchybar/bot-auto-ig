import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { fetchMediaLikersPage, mediaPkFromShortcode, parsePostInput } from './igWebApi.js'

// Runs the browser callback in Node by shimming document/fetch globals,
// same pattern as scrape.test.ts.
function mockPage() {
    return {
        evaluate: async (fn: (args: any) => unknown, args: any) => fn(args),
    } as unknown as Page
}

test('mediaPkFromShortcode matches instagrapi codec vectors', () => {
    assert.equal(mediaPkFromShortcode('B1LbfVPlwIA'), '2110901750722920960')
    assert.equal(mediaPkFromShortcode('B-fKL9qpeab'), '2278584739065882267')
    assert.throws(() => mediaPkFromShortcode('!!!'), /Invalid post shortcode/)
})

test('parsePostInput accepts urls, shortcodes, and media ids', () => {
    assert.deepEqual(parsePostInput('https://www.instagram.com/p/B1LbfVPlwIA/'), {
        mediaPk: '2110901750722920960',
        postUrl: 'https://www.instagram.com/p/B1LbfVPlwIA/',
    })
    assert.deepEqual(
        parsePostInput('https://www.instagram.com/reel/B-fKL9qpeab/?igshid=xyz'),
        {
            mediaPk: '2278584739065882267',
            postUrl: 'https://www.instagram.com/p/B-fKL9qpeab/',
        },
    )
    assert.deepEqual(parsePostInput('B1LbfVPlwIA'), {
        mediaPk: '2110901750722920960',
        postUrl: 'https://www.instagram.com/p/B1LbfVPlwIA/',
    })
    assert.deepEqual(parsePostInput('2110901750722920960'), {
        mediaPk: '2110901750722920960',
        postUrl: 'https://www.instagram.com/p/2110901750722920960/',
    })
    assert.equal(parsePostInput('not a post'), null)
    assert.equal(parsePostInput(''), null)
    assert.equal(parsePostInput(null), null)
})

test('media likers pages with count and max_id cursors', async () => {
    const originalFetch = globalThis.fetch
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const calls: string[] = []
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'csrftoken=abc' } })
    globalThis.fetch = (async (url: RequestInfo | URL) => {
        calls.push(String(url))
        return String(url).includes('max_id')
            ? Response.json({ users: [{ pk: '2', username: 'b' }] })
            : Response.json({ users: [{ pk: '1', username: 'a' }], next_max_id: 'next' })
    }) as typeof fetch
    try {
        const first = await fetchMediaLikersPage(mockPage(), '2110901750722920960', null)
        assert.match(calls[0], /\/api\/v1\/media\/2110901750722920960\/likers\//)
        assert.match(calls[0], /count=100/)
        assert.equal(first.cursor, 'next')
        const second = await fetchMediaLikersPage(mockPage(), '2110901750722920960', first.cursor)
        assert.match(calls[1], /max_id=next/)
        assert.equal(second.cursor, null)
        assert.deepEqual(second.users.map((user) => user.username), ['b'])
    } finally {
        globalThis.fetch = originalFetch
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
        else Reflect.deleteProperty(globalThis, 'document')
    }
})

test('media likers maps numeric cursors and rejects bad payloads', async () => {
    const originalFetch = globalThis.fetch
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } })
    try {
        globalThis.fetch = (async () =>
            Response.json({ users: [{ pk: 1, username: 'a' }], next_max_id: 12345 })) as typeof fetch
        const page = await fetchMediaLikersPage(mockPage(), '123', null)
        assert.equal(page.cursor, '12345')
        // Login redirect serves HTML instead of JSON.
        globalThis.fetch = (async () =>
            new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch
        await assert.rejects(fetchMediaLikersPage(mockPage(), '123', null), /login required/)
        globalThis.fetch = (async () => Response.json({ status: 'fail', users: [] })) as typeof fetch
        await assert.rejects(fetchMediaLikersPage(mockPage(), '123', null), /unsuccessful or incomplete/)
    } finally {
        globalThis.fetch = originalFetch
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
        else Reflect.deleteProperty(globalThis, 'document')
    }
})

test('media likers maps auth, missing, and throttle errors', async () => {
    const originalFetch = globalThis.fetch
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } })
    try {
        globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch
        await assert.rejects(fetchMediaLikersPage(mockPage(), '123', null), /login required/)
        globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
        await assert.rejects(fetchMediaLikersPage(mockPage(), '123', null), /Post not found/)
        globalThis.fetch = (async () => new Response('{}', { status: 429 })) as typeof fetch
        await assert.rejects(fetchMediaLikersPage(mockPage(), '123', null), /throttled/)
        globalThis.fetch = (async () => Response.json({ users: 'nope' })) as typeof fetch
        await assert.rejects(fetchMediaLikersPage(mockPage(), '123', null), /unsuccessful or incomplete/)
    } finally {
        globalThis.fetch = originalFetch
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
        else Reflect.deleteProperty(globalThis, 'document')
    }
})
