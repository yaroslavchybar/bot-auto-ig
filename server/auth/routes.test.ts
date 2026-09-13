import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Request } from 'express'
import { clientIp } from './routes.js'

function fakeReq(overrides: Partial<Request> = {}): Request {
    const header = ((name: string) =>
        name === 'X-Forwarded-For'
            ? '1.2.3.4, 5.6.7.8'
            : undefined) as Request['header']
    return {
        ip: '203.0.113.7',
        socket: { remoteAddress: '10.0.0.5' },
        header,
        ...overrides,
    } as unknown as Request
}

test('clientIp uses req.ip and ignores client-supplied X-Forwarded-For', () => {
    assert.equal(clientIp(fakeReq()), '203.0.113.7')
})

test('clientIp falls back to the socket address without req.ip', () => {
    const req = fakeReq({ ip: undefined })
    assert.equal(clientIp(req), '10.0.0.5')
})
