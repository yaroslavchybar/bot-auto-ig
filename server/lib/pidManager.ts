/**
 * PID Manager - Track automation process IDs for orphan cleanup.
 * On server crash/restart, this allows killing leftover Python processes.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Store PID file in server's data directory
const DATA_DIR = path.resolve(__dirname, '../data')
const PID_FILE = path.join(DATA_DIR, 'automation.pid')

/**
 * Ensure data directory exists.
 */
function ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
    }
}

/**
 * Save the PID of the running automation process.
 */
export function savePid(pid: number): void {
    ensureDataDir()
    fs.writeFileSync(PID_FILE, String(pid), 'utf-8')
    console.log(`[PID Manager] Saved PID ${pid}`)
}

/**
 * Clear the PID file when process exits normally.
 */
export function clearPid(): void {
    try {
        if (fs.existsSync(PID_FILE)) {
            fs.unlinkSync(PID_FILE)
            console.log('[PID Manager] Cleared PID file')
        }
    } catch (err) {
        console.error('[PID Manager] Failed to clear PID file:', err)
    }
}

/**
 * Get the stored PID if any.
 */
export function getSavedPid(): number | null {
    try {
        if (!fs.existsSync(PID_FILE)) return null
        const content = fs.readFileSync(PID_FILE, 'utf-8').trim()
        const pid = parseInt(content, 10)
        return Number.isFinite(pid) && pid > 0 ? pid : null
    } catch {
        return null
    }
}

/**
 * Check if a process with the given PID is running.
 */
function isProcessRunning(pid: number): boolean {
    try {
        // Sending signal 0 checks if process exists without killing it
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

/**
 * Kill a process by PID, trying SIGTERM first then SIGKILL.
 */
async function killProcess(pid: number): Promise<boolean> {
    try {
        console.log(`[PID Manager] Attempting to kill orphaned process ${pid}`)

        // Try graceful termination first
        process.kill(pid, 'SIGTERM')

        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 2000))

        // Force kill if still running
        if (isProcessRunning(pid)) {
            process.kill(pid, 'SIGKILL')
            console.log(`[PID Manager] Force killed process ${pid}`)
        } else {
            console.log(`[PID Manager] Process ${pid} terminated gracefully`)
        }

        return true
    } catch (err) {
        // ESRCH means process doesn't exist - that's fine
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
            console.log(`[PID Manager] Process ${pid} already dead`)
            return true
        }
        console.error(`[PID Manager] Failed to kill process ${pid}:`, err)
        return false
    }
}

/**
 * Clean up any orphaned automation processes from previous server runs.
 * Call this on server startup.
 */
export async function cleanupOrphanedProcesses(): Promise<void> {
    const pid = getSavedPid()

    if (!pid) {
        console.log('[PID Manager] No orphaned processes to clean up')
        return
    }

    console.log(`[PID Manager] Found orphaned PID ${pid}, checking if running...`)

    if (isProcessRunning(pid)) {
        await killProcess(pid)
    } else {
        console.log(`[PID Manager] Process ${pid} is not running`)
    }

    // Always clear the PID file after cleanup attempt
    clearPid()
}
