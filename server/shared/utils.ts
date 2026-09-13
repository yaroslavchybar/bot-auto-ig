import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveProjectRoot(moduleUrl: string): string {
  let directory = path.dirname(fileURLToPath(moduleUrl))
  while (path.basename(directory) !== 'server') {
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error('Expected a module inside the server directory')
    directory = parent
  }
  return path.dirname(directory)
}
