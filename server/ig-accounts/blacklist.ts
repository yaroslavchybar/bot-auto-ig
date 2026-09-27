import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveProjectRoot } from '../shared/utils.js'

export type BlacklistedProxy = { ip: string; country: string; proxyName: string; reason: string; createdAt: number }
const file = path.join(resolveProjectRoot(import.meta.url), 'data', 'login-proxy-blacklist.json')
let pending: Promise<unknown> = Promise.resolve()

async function read(): Promise<BlacklistedProxy[]> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as BlacklistedProxy[] }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function listBlacklistedProxies(): Promise<BlacklistedProxy[]> {
  await pending
  return read()
}

export async function blacklistProxy(row: BlacklistedProxy): Promise<void> {
  const work = pending.then(async () => {
    const rows = await read()
    if (rows.some(existing => existing.ip === row.ip)) return
    rows.push(row)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    await fs.writeFile(temp, JSON.stringify(rows), { mode: 0o600 })
    await fs.rename(temp, file)
  })
  pending = work.catch(() => undefined)
  await work
}
