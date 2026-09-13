import path from 'node:path'
import dotenv from 'dotenv'
import { resolveProjectRoot } from './shared/utils.js'

// Executables share one root rule; real environment variables take precedence.
dotenv.config({ path: path.join(resolveProjectRoot(import.meta.url), '.env.local'), quiet: true })
