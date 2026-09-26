import fs from 'node:fs'
import path from 'node:path'
import { profileDirectory } from '../profiles/paths.js'
import { profilesList, profilesUpdateByName } from '../shared/convexClient.js'

/** Save seeds from profiles created before Convex stored them. Never create a folder. */
export async function backfillLocalCloakSeeds(): Promise<number> {
  let saved = 0
  for (const profile of await profilesList()) {
    if (Number.isSafeInteger(profile.fingerprintSeed) || profile.status === 'deleting' || profile.renameFrom) continue
    let raw: string
    try {
      raw = fs.readFileSync(path.join(profileDirectory(profile.name), 'cloak-seed.json'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    let local: { platform?: unknown; seed?: unknown }
    try {
      local = JSON.parse(raw)
    } catch (error) {
      if (error instanceof SyntaxError) continue
      throw error
    }
    const os = String(profile.fingerprintOs || '').trim().toLowerCase()
    const platform = os === 'mac' || os === 'macos' ? 'macos' : 'windows'
    if (local?.platform !== platform || !Number.isSafeInteger(local?.seed)) continue
    try {
      const updated = await profilesUpdateByName(profile.name, {
        name: profile.name,
        fingerprintSeed: local.seed as number,
      })
      if (updated?.fingerprintSeed !== local.seed) throw new Error('Convex did not confirm the saved seed')
      saved++
    } catch (error) {
      throw new Error(`Could not backfill Cloak fingerprint seed for ${profile.name}`, { cause: error })
    }
  }
  return saved
}
