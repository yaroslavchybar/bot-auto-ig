import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserContext } from 'playwright-core'
import { DOM_INSPECTOR_FILE, startDomInspector } from './domInspector.js'

test('serves live page DOM on a loopback-only port and removes its port file on close', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-dom-inspector-'))
  const context = {
    pages: () => [{
      url: () => 'https://www.instagram.com/consent/',
      content: async () => '<html><body><div role="button">Decline optional cookies</div></body></html>',
      ariaSnapshot: async () => '- button "Decline optional cookies"',
    }],
  } as unknown as BrowserContext
  let inspector: Awaited<ReturnType<typeof startDomInspector>> | undefined
  try {
    inspector = await startDomInspector(context, profileDir)
    const info = JSON.parse(fs.readFileSync(path.join(profileDir, DOM_INSPECTOR_FILE), 'utf8'))
    assert.equal(info.port, inspector.port)

    const base = `http://127.0.0.1:${inspector.port}`
    const pages = await fetch(`${base}/pages`)
    assert.deepEqual(await pages.json(), [{ index: 0, url: 'https://www.instagram.com/consent/' }])
    const dom = await fetch(`${base}/dom?index=0`)
    assert.equal(dom.status, 200)
    assert.match(await dom.text(), /Decline optional cookies/)
    assert.match(await (await fetch(`${base}/aria?index=0`)).text(), /button "Decline optional cookies"/)
    assert.equal((await fetch(`${base}/dom?index=1`)).status, 404)
    assert.equal((await fetch(`${base}/dom`, { method: 'POST' })).status, 405)
    assert.equal((await fetch(`${base}/dom`, { headers: { Origin: 'https://www.instagram.com' } })).status, 403)

    await inspector.close()
    assert.equal(fs.existsSync(path.join(profileDir, DOM_INSPECTOR_FILE)), false)
  } finally {
    await inspector?.close()
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
