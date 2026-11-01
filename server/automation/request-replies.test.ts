import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { acceptRequest, replyToMessageRequests, requestControl, requestIdentity, RequestIdentityError } from './request-replies.js'
import { ConvexHttpError } from '../shared/convexClient.js'
import type { ActionLogger } from './actions/shared.js'
import { Window } from 'happy-dom'
import { BrowseSession, SessionEnded } from './actions/session.js'
import { visibleActionGeometry } from './actions/action-locator.test-support.js'

function fixture(getHref: () => Promise<string | null> = async () => '/alice/') {
  const calls: string[] = []
  const logs: Parameters<ActionLogger>[0][] = []
  let stage = 'accept', stopped = false
  let delivered = 0
  const confirmations: number[] = []
  class Field {
    constructor(readonly key = '', readonly position?: number) {}
    filter() { return this }
    first() { return this }
    last() { return this }
    nth(index: number) { return new Field(this.key, index) }
    or(other: Field) { return new Field(`${this.key}|${other.key}`) }
    and() { return this }
    locator(selector: string) { return selector === '[role="button"]' ? new Field('rows') : selector.startsWith('[role="article"]') ? new Field('outgoing') : this }
    getByRole(role: string, options: { name?: string } = {}) { return new Field(role === 'textbox' ? 'editor' : options.name ?? role) }
    getByText() { return new Field('text') }
    count = async () => this.key === 'rows' ? Number(stage === 'accept') : ['text', 'outgoing'].includes(this.key) ? delivered : 0
    getAttribute = getHref
    isVisible = async () => this.key === 'Accept' ? stage === 'accept' : this.key === 'Primary' ? stage === 'picker' : false
    waitFor = async () => {
      if (this.key === 'editor') assert.equal(stage, 'editor')
      if (['text', 'outgoing'].includes(this.key) && this.position !== undefined) {
        confirmations.push(this.position); assert.ok(delivered > this.position, 'require another outgoing message')
      }
    }
    elementHandle = visibleActionGeometry.elementHandle
    click = async () => {
      calls.push(this.key)
      if (this.key === 'Accept') stage = 'picker'
      if (this.key === 'Primary') stage = 'editor'
    }
  }
  const editor = new Field('editor')
  const page = { url: () => 'https://www.instagram.com/direct/t/123/',
    locator: () => new Field(), getByText: () => new Field('text'),
    getByRole: (_role: string, opts: { name?: string } = {}) => new Field(opts.name ?? _role),
    goto: async () => { calls.push('navigate') },
  } as unknown as Page
  const identity = { username: 'alice', threadId: '123' }
  const deps: NonNullable<Parameters<typeof replyToMessageRequests>[5]> = {
    plan: async () => ({ message: 'Hello {{username}}', uncertain: false, pending: [identity] }),
    prepare: async () => { calls.push('prepare'); return true },
    begin: async () => { calls.push('claim'); return true },
    finish: async ({ sent, blocked }) => { calls.push(sent ? 'sent' : blocked ? 'blocked' : 'uncertain') },
    type: async (_composer, message) => { assert.equal(message, 'Hello alice'); calls.push('type') },
    send: async () => { calls.push('send'); delivered++ }, blocked: async () => false,
    check: async () => {}, home: async () => { calls.push('home') },
    history: async () => ({ ownUsername: 'self', hasOwnMessage: false, threadId: '123' }),
    recordExisting: async () => { calls.push('existing-dm'); return true },
    identity: async () => identity,
    accept: async () => { calls.push('accepted'); stage = 'editor'; return editor as unknown as Locator },
  }
  return { calls, logs, confirmations, deps, page, identity, setStage: (value: string) => { stage = value },
    stop: () => { stopped = true }, session: () => new BrowseSession(Date.now() + 60_000, () => stopped),
    run: () => replyToMessageRequests('automation', 'profile', page, new BrowseSession(Date.now() + 60_000, () => stopped), fields => { logs.push(fields) }, deps) }
}

test('missing or malformed request identities throw a typed UI error', async () => {
  for (const href of [null, '/not/a/username/']) {
    const f = fixture(async () => href)
    await assert.rejects(requestIdentity(f.page), RequestIdentityError)
  }
  const f = fixture()
  f.page.url = () => 'https://www.instagram.com/direct/inbox/'
  await assert.rejects(requestIdentity(f.page), RequestIdentityError)
})

test('acceptance rejects changed recipients with a typed UI error before input', async () => {
  const f = fixture()
  await assert.rejects(acceptRequest(f.page, { ...f.identity, username: 'bob' }, f.session()), RequestIdentityError)
  assert.deepEqual(f.calls, [])
})

test('acceptance detects a recipient changing after selecting Primary', async () => {
  let reads = 0
  const f = fixture(async () => ++reads === 1 ? '/alice/' : '/bob/')
  await assert.rejects(acceptRequest(f.page, f.identity, f.session()), RequestIdentityError)
  assert.deepEqual(f.calls, ['Accept', 'Primary'])
})

for (const mismatch of ['unavailable', 'pending username', 'pending thread', 'before Send'])
  test(`a request identity mismatch (${mismatch}) is logged and skips optional replies`, async () => {
    const f = fixture()
    let reads = 0
    f.deps.identity = async () => {
      if (mismatch === 'unavailable') throw new RequestIdentityError('Message request identity unavailable')
      if (mismatch === 'before Send' && ++reads <= 2) return f.identity
      return mismatch === 'pending thread' ? { ...f.identity, threadId: '456' } : { ...f.identity, username: 'bob' }
    }
    await f.run()
    assert.ok(f.calls.includes('home'))
    assert.ok(!f.calls.includes('claim') && !f.calls.includes('send') && !f.calls.includes('sent'))
    assert.equal(f.logs.length, 1)
    assert.equal(f.logs[0].event, 'automation.request_replies_skipped')
    assert.equal(f.logs[0].outcome, 'skipped')
    assert.ok(f.logs[0].error instanceof RequestIdentityError)
  })

for (const stage of ['plan', 'prepare'] as const) test(`Convex ${stage} failures still stop the session`, async () => {
  const f = fixture(), failure = new ConvexHttpError(503, 'Unavailable')
  f.deps[stage] = async () => { throw failure }
  await assert.rejects(f.run(), error => error === failure)
  assert.ok(!f.calls.includes('send') && !f.calls.includes('home'))
  assert.deepEqual(f.logs, [])
})

test('an account warning during identity recovery still stops the session', async () => {
  const f = fixture(), warning = new Error('Instagram checkpoint needs attention')
  f.deps.identity = async () => { throw new RequestIdentityError('Message request identity unavailable') }
  f.deps.check = async () => { throw warning }
  await assert.rejects(f.run(), error => error === warning)
  assert.ok(!f.calls.includes('send') && !f.calls.includes('home'))
  assert.deepEqual(f.logs, [])
})

test('request acceptance selects Primary before exposing the message editor', async () => {
  const f = fixture()
  await acceptRequest(f.page, f.identity, f.session())
  assert.deepEqual(f.calls, ['Accept', 'Primary'])
  f.calls.length = 0
  await acceptRequest(f.page, f.identity, f.session())
  assert.deepEqual(f.calls, [], 'an accepted pending request resumes without another acceptance')
})

test('stopping after acceptance prevents selecting Primary', async () => {
  const f = fixture(), session = f.session()
  let checks = 0
  session.check = () => { if (++checks === 3) throw new SessionEnded() }
  await assert.rejects(acceptRequest(f.page, f.identity, session), SessionEnded)
  assert.ok(!f.calls.includes('Primary'))
})

test('pending requests accept, type, authorize and send in order', async () => {
  const f = fixture()
  await f.run()
  assert.deepEqual(f.calls.slice(0, 7), ['navigate', 'prepare', 'accepted', 'type', 'claim', 'send', 'sent'])
})

test('a request sends backslash-separated messages under one claim and verifies repeated text separately', async () => {
  const f = fixture(), drafts: string[] = []
  f.deps.plan = async () => ({ message: 'Hello alice \\ Hello alice', uncertain: false, pending: [f.identity] })
  f.deps.type = async (_editor, text) => { drafts.push(text) }
  await f.run()
  assert.deepEqual(drafts, ['Hello alice', 'Hello alice'])
  assert.deepEqual(f.confirmations, [0, 1])
  assert.equal(f.calls.filter(c => c === 'claim').length, 1)
  assert.equal(f.calls.filter(c => c === 'send').length, 2)
  assert.equal(f.calls.filter(c => c === 'sent').length, 1)
})

for (const interruption of ['failure', 'stop'] as const) test(`a ${interruption} after the first request reply never restarts the sequence`, async () => {
  const f = fixture(), send = f.deps.send
  f.deps.plan = async () => ({ message: 'Hello alice \\ Hello alice \\ Third', uncertain: false, pending: [f.identity] })
  let attempts = 0
  f.deps.send = async (...args) => {
    if (++attempts === 2) throw new Error('Connection reset')
    await send(...args)
    if (interruption === 'stop') f.stop()
  }
  await assert.rejects(f.run(), /Delivery needs review/)
  assert.equal(attempts, interruption === 'stop' ? 1 : 2)
  assert.equal(f.calls.filter(c => c === 'claim').length, 1)
  assert.ok(f.calls.includes('uncertain') && !f.calls.includes('sent') && !f.calls.includes('home'))
})

test('an accepted request with our manual reply is marked sent without typing or sending again', async () => {
  const f = fixture()
  f.deps.history = async () => ({ ownUsername: 'self', hasOwnMessage: true, threadId: '123' })
  f.deps.recordExisting = async args => {
    assert.deepEqual(args, { automationId: 'automation', profileId: 'profile', username: 'alice', threadId: '123' })
    f.calls.push('existing-dm'); return true
  }
  await f.run()
  assert.deepEqual(f.calls.slice(0, 4), ['navigate', 'prepare', 'accepted', 'existing-dm'])
  for (const call of ['type', 'claim', 'send', 'sent']) assert.ok(!f.calls.includes(call), call)
})

test('failed persistence of a detected manual request reply never sends a duplicate', async () => {
  const f = fixture(), failure = new ConvexHttpError(503, 'Unavailable')
  f.deps.history = async () => ({ ownUsername: 'self', hasOwnMessage: true, threadId: '123' })
  f.deps.recordExisting = async () => { throw failure }
  await assert.rejects(f.run(), error => error === failure)
  for (const call of ['type', 'claim', 'send', 'sent', 'home']) assert.ok(!f.calls.includes(call), call)
})

test('a new visible request is prepared before acceptance and replied to once', async () => {
  const f = fixture()
  f.deps.plan = async () => ({ message: 'Hello {{username}}', uncertain: false, pending: [] })
  await f.run()
  assert.deepEqual(f.calls.filter(c => ['prepare', 'accepted', 'type', 'claim', 'send', 'sent'].includes(c)),
    ['prepare', 'accepted', 'type', 'claim', 'send', 'sent'])
  assert.ok(!f.calls.includes('navigate'), 'new requests open from the observed inbox UI')
})

test('a stopped claimed send is recorded as uncertain and never starts input', async () => {
  const f = fixture()
  f.deps.begin = async () => { f.calls.push('claim'); f.stop(); return true }
  await assert.rejects(f.run(), /Delivery needs review/)
  assert.ok(f.calls.includes('uncertain'))
  assert.ok(!f.calls.includes('send') && !f.calls.includes('home'))
})

test('a failed Send is never retried, and cleanup cannot replace its review error', async () => {
  const f = fixture()
  f.deps.send = async () => { f.calls.push('send'); throw new Error('connection reset') }
  f.deps.home = async () => { throw new Error('unrelated cleanup failure') }
  await assert.rejects(f.run(), /Delivery needs review/)
  assert.equal(f.calls.filter(c => c === 'send').length, 1)
  assert.ok(f.calls.includes('uncertain'))
})

test('an uncertain previous claim stops before opening any thread', async () => {
  const f = fixture()
  f.deps.plan = async () => ({ message: 'Hi', uncertain: true, pending: [] })
  await assert.rejects(f.run(), /Delivery needs review/)
  assert.deepEqual(f.calls, [])
})

test('a rejected final authorization clears the draft and never clicks Send', async () => {
  const f = fixture(), drafts: string[] = []
  f.deps.begin = async () => false
  f.deps.type = async (_composer, message) => { drafts.push(message) }
  await f.run()
  assert.deepEqual(drafts, ['Hello alice', ''])
  assert.ok(!f.calls.includes('send') && !f.calls.includes('sent'))
})

test('failure to persist delivery stops the session for review without navigating away', async () => {
  const f = fixture()
  f.deps.finish = async () => { throw new Error('network failure') }
  await assert.rejects(f.run(), /Delivery result needs review/)
  assert.equal(f.calls.filter(c => c === 'send').length, 1)
  assert.ok(!f.calls.includes('home'))
})

for (const role of ['tab', 'link']) test(`Requests discovery supports the observed ${role} layout`, async () => {
  const window = new Window(), doc = window.document
  doc.body.innerHTML = `<main><div role="navigation" aria-label="Thread list">${role === 'tab'
    ? '<div role="tab">Primary</div><div role="tab" id="requests">Request (1)</div>'
    : '<a role="link" href="/direct/requests/" id="requests">Request (1)</a>'}</div></main>`
  class Query {
    constructor(readonly nodes: Element[]) {}
    getByRole(kind: string, { name }: { name: string | RegExp }) { return new Query(this.nodes.flatMap(node => [...node.querySelectorAll(`[role="${kind}"]`)])
      .filter(node => { const text = node.getAttribute('aria-label') ?? node.textContent ?? ''; return typeof name === 'string' ? text === name : name.test(text) })) }
    locator(selector: string) { return new Query(this.nodes.flatMap(node => [...node.querySelectorAll(selector)])) }
    or(other: Query) { return new Query([...new Set([...this.nodes, ...other.nodes])]) }
    filter() { return this }
    first() { return new Query(this.nodes.slice(0, 1)) }
    getAttribute(name: string) { return Promise.resolve(this.nodes[0]?.getAttribute(name)) }
  }
  try {
    const page = new Query([doc.documentElement as unknown as Element]) as unknown as Page
    assert.equal(await requestControl(page).getAttribute('id'), 'requests')
  } finally { await window.happyDOM.close() }
})
