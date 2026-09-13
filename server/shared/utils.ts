import path from 'path'
import { fileURLToPath } from 'url'

export function resolveProjectRoot(moduleUrl: string) {
    const modulePath = fileURLToPath(moduleUrl)
    const moduleDir = path.dirname(modulePath)
    const inDist = path.basename(path.dirname(moduleDir)) === 'dist'
    return inDist
        ? path.resolve(moduleDir, '../../..')
        : path.resolve(moduleDir, '../..')
}
