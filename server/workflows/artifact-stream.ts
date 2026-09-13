import fs from 'node:fs/promises'
import path from 'node:path'

/** Assemble the committed snapshot a chunk at a time; downloads never load all users. */
export async function* artifactJson(filename: string): AsyncGenerator<string> {
  const metadata = JSON.parse(await fs.readFile(filename, 'utf8'))
  if (metadata.format !== 'ig-bot-chunks-v1') throw new Error('Unsupported artifact format; start a fresh workflow run')
  const chunks = metadata.progress?.chunks
  if (!Number.isSafeInteger(chunks) || chunks < 0) throw new Error('Invalid artifact checkpoint')
  const { format, ...payload } = metadata
  yield `${JSON.stringify(payload).slice(0, -1)},"users":[`
  let separator = ''
  const root = await fs.realpath(`${filename}.chunks`)
  const parent = await fs.realpath(path.dirname(filename))
  if (path.dirname(root) !== parent) throw new Error('Invalid artifact chunk directory')
  for (let index = 0; index < chunks; index++) {
    const chunk = await fs.realpath(path.join(root, `${index}.json`))
    if (path.dirname(chunk) !== root) throw new Error('Invalid artifact chunk path')
    const users: unknown[] = JSON.parse(await fs.readFile(chunk, 'utf8'))
    if (!Array.isArray(users)) throw new Error('Invalid artifact chunk')
    if (!users.length) continue
    yield separator + JSON.stringify(users).slice(1, -1)
    separator = ','
  }
  yield ']}'
}
