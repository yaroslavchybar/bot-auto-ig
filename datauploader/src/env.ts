import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

// Load shared env from repo root .env.local (single local source of truth).
// Bun only auto-loads .env from the workspace cwd (datauploader/), so without
// this the root vars are invisible here. Container/prod env arrives as real
// environment variables, which dotenv never overrides.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')

dotenv.config({ path: path.join(projectRoot, '.env.local') })
