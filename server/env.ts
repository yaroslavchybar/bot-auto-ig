import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

// Single local source of truth: root .env.local.
// Container/prod env arrives as real environment variables, which dotenv never overrides.
dotenv.config({ path: path.join(projectRoot, '.env.local') })
