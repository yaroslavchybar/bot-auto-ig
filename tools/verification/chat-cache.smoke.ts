import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

// Run with `bun tools/verification/chat-cache.smoke.ts`; exercises real browser storage and locks.
const directory = mkdtempSync(path.join(os.tmpdir(), 'chat-browser-'))
const root = path.resolve(import.meta.dir, '../..')
const entry = path.join(directory, 'entry.ts')
await Bun.write(
  entry,
  `
  import { fetchChatSnapshot, subscribeChatResponses } from ${JSON.stringify(path.join(root, 'frontend/src/features/chat/requests.ts'))};
  import { clearSharedChatResponses } from ${JSON.stringify(path.join(root, 'frontend/src/features/chat/cache.ts'))};
  const events = [];
  const unsubscribe = subscribeChatResponses((userId, path) => events.push({ userId, path }));
  Object.assign(window, { fetchChatSnapshot, clearSharedChatResponses, events, unsubscribe, ready: true });
`,
)
let fetches = 0
const build = await Bun.build({
  entrypoints: [entry],
  target: 'browser',
  plugins: [
    {
      name: 'test-transport',
      setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/api$/ }, () => ({ path: 'api', namespace: 'test' }))
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          loader: 'js',
          contents:
            'export async function apiFetch(path, options) { return (await fetch(path, { signal: options.signal })).json() }',
        }))
      },
    },
  ],
})
assert.ok(build.success, String(build.logs))
const bundle = await build.outputs[0].text()
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') {
    res.setHeader('content-type', 'text/javascript')
    res.end(bundle)
    return
  }
  if (req.url?.startsWith('/data')) {
    const value = ++fetches
    setTimeout(() => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ value }))
    }, 100)
    return
  }
  res.setHeader('content-type', 'text/html')
  res.end('<script type="module" src="/bundle.js"></script>')
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const url = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === 'win32'
    ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }
    : {}),
})
try {
  const context = await browser.newContext()
  const [one, two] = await Promise.all([context.newPage(), context.newPage()])
  await Promise.all([one.goto(url), two.goto(url)])
  await Promise.all([one.waitForFunction('window.ready'), two.waitForFunction('window.ready')])
  const results = await Promise.all(
    [one, two].map((page) => page.evaluate('window.fetchChatSnapshot("user", "/data", {})')),
  )
  assert.deepEqual(results[0], results[1])
  assert.equal(fetches, 1)
  const deadline = Date.now() + 5_000
  let notified = false
  while (!notified && Date.now() < deadline) {
    const notices = await Promise.all([one, two].map((page) => page.evaluate('window.events')))
    notified = notices
      .flat()
      .some(
        (event: { userId: string; path: string }) =>
          event.userId === 'user' && event.path === '/data',
      )
    if (!notified) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(notified, 'The other tab received a cache-key notification')
  await one.reload()
  await one.waitForFunction('window.ready')
  assert.deepEqual(await one.evaluate('window.fetchChatSnapshot("user", "/data", {})'), results[0])
  assert.equal(fetches, 1)
  await two.evaluate('window.fetchChatSnapshot("other", "/data", {})')
  assert.equal(fetches, 2)

  const leader = one.evaluate('window.fetchChatSnapshot("user", "/data?slow", {})')
  while (fetches < 3) await new Promise((resolve) => setTimeout(resolve, 5))
  const follower = await two.evaluate(`(async () => {
    const controller = new AbortController();
    const request = window.fetchChatSnapshot('user', '/data?slow', { signal: controller.signal });
    controller.abort();
    try { await request; return 'unexpected'; } catch (error) { return error.name; }
  })()`)
  assert.equal(follower, 'AbortError')
  await leader
  assert.equal(fetches, 3)

  await one.evaluate(`(async () => {
    for (let i=0; i<25; i++) await window.fetchChatSnapshot('user', '/data?thread=' + i, {});
  })()`)
  const count = await one.evaluate(`new Promise(resolve => {
    const open = indexedDB.open('ig-bot-chat-cache', 2);
    open.onsuccess = () => {
      const request = open.result.transaction('snapshots').objectStore('snapshots').getAllKeys();
      request.onsuccess = () => { resolve(request.result.filter(key => key.startsWith('user:request:')).length); open.result.close(); };
    };
  })`)
  assert.equal(count, 20)
  await one.evaluate('window.clearSharedChatResponses("user")')
  await one.evaluate('window.fetchChatSnapshot("user", "/data", {})')
  assert.equal(fetches, 29)
  await Promise.all([one, two].map((page) => page.evaluate('window.unsubscribe()')))
  console.log(
    'PASS: one fetch across tabs, disk persistence, user isolation, cancellation, invalidation, and bounded IndexedDB responses',
  )
} finally {
  await browser.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
  assert.ok(path.basename(directory).startsWith('chat-browser-'))
  rmSync(directory, { recursive: true, force: true })
}
