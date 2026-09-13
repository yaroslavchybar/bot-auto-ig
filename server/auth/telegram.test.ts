import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    allowLoginAttempt,
    confirmPendingLogin,
    consumePendingLogin,
    createPendingLogin,
    getPublicBaseUrl,
    LOGIN_TOKEN_RE,
    peekPendingLogin,
} from './telegram.js'

test('deep-link login token is single-use: pending -> confirmed -> consumed', () => {
    const token = createPendingLogin()
    assert.ok(token)
    assert.match(token, LOGIN_TOKEN_RE)

    assert.equal(peekPendingLogin(token)?.user, null)
    assert.equal(consumePendingLogin(token)?.user, null)
    // Still pending after a poll peek: confirmation can land afterwards.
    assert.equal(
        confirmPendingLogin(token, { id: '550772522', firstName: 'Admin' }),
        true,
    )
    // Second confirmation is rejected.
    assert.equal(
        confirmPendingLogin(token, { id: '1', firstName: 'Other' }),
        false,
    )
    assert.equal(peekPendingLogin(token)?.user?.id, '550772522')

    const consumed = consumePendingLogin(token)
    assert.equal(consumed?.user?.id, '550772522')
    // Single-use: gone after consume.
    assert.equal(peekPendingLogin(token), null)
    assert.equal(consumePendingLogin(token), null)
    assert.equal(
        confirmPendingLogin(token, { id: '1', firstName: 'Late' }),
        false,
    )
})

test('unknown tokens are rejected', () => {
    const fake = '0'.repeat(32)
    assert.equal(peekPendingLogin(fake), null)
    assert.equal(consumePendingLogin(fake), null)
    assert.equal(
        confirmPendingLogin(fake, { id: '1', firstName: 'Nobody' }),
        false,
    )
})

test('login rate limiter allows the limit then blocks per key', () => {
    const key = `test-${Date.now()}-${Math.random()}`
    assert.equal(allowLoginAttempt(key, 2, 60_000), true)
    assert.equal(allowLoginAttempt(key, 2, 60_000), true)
    assert.equal(allowLoginAttempt(key, 2, 60_000), false)
    assert.equal(allowLoginAttempt(`${key}-other`, 2, 60_000), true)
})

test('public base URL prefers PUBLIC_BASE_URL and trims slashes', () => {
    const saved = {
        PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
        APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    }
    try {
        process.env.PUBLIC_BASE_URL = 'https://bot.example.com/'
        process.env.APP_PUBLIC_URL = 'https://fallback.example.com'
        process.env.ALLOWED_ORIGINS = 'https://origins.example.com'
        assert.equal(getPublicBaseUrl(), 'https://bot.example.com')

        delete process.env.PUBLIC_BASE_URL
        assert.equal(getPublicBaseUrl(), 'https://fallback.example.com')

        delete process.env.APP_PUBLIC_URL
        process.env.ALLOWED_ORIGINS =
            'https://first.example.com,https://second.example.com'
        assert.equal(getPublicBaseUrl(), 'https://first.example.com')
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
})
