/**
 * State Manager - Persist automation state to file for crash recovery.
 * On server crash/restart, this allows detecting interrupted automation runs.
 */
import fs from 'fs'
import logger from '../shared/logger.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Store state file in server's data directory
const DATA_DIR = path.resolve(__dirname, '../data')
const STATE_FILE = path.join(DATA_DIR, 'automation_state.json')

/**
 * Persisted automation state.
 */
export interface PersistedState {
    status: 'idle' | 'running' | 'stopping'
    pid: number | null
    startedAt: string | null
    settings: Record<string, unknown> | null
}

/**
 * Default state when nothing is persisted.
 */
const DEFAULT_STATE: PersistedState = {
    status: 'idle',
    pid: null,
    startedAt: null,
    settings: null,
}

/**
 * Ensure data directory exists.
 */
function ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
    }
}

/**
 * Save automation state to file.
 */
export function saveState(state: Partial<PersistedState>): void {
    ensureDataDir()
    const current = loadState()
    const merged: PersistedState = { ...current, ...state }
    fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), 'utf-8')
    logger.info({ status: merged.status }, 'Saved automation state')
}

/**
 * Load persisted automation state.
 */
export function loadState(): PersistedState {
    try {
        if (!fs.existsSync(STATE_FILE)) return DEFAULT_STATE
        const content = fs.readFileSync(STATE_FILE, 'utf-8')
        const parsed = JSON.parse(content)
        return { ...DEFAULT_STATE, ...parsed }
    } catch (err) {
        logger.error({ err }, 'Failed to load automation state')
        return DEFAULT_STATE
    }
}

/**
 * Clear persisted state (reset to idle).
 */
export function clearState(): void {
    try {
        if (fs.existsSync(STATE_FILE)) {
            fs.unlinkSync(STATE_FILE)
            logger.info('Cleared automation state file')
        }
    } catch (err) {
        logger.error({ err }, 'Failed to clear automation state')
    }
}

/**
 * Mark automation as started.
 */
export function markStarted(pid: number, settings: Record<string, unknown>): void {
    saveState({
        status: 'running',
        pid,
        startedAt: new Date().toISOString(),
        settings,
    })
}

/**
 * Mark automation as stopped/completed.
 */
export function markStopped(): void {
    clearState()
}

/**
 * Check if there was an interrupted run from a previous session.
 */
export function detectInterruptedRun(): PersistedState | null {
    const state = loadState()
    if (state.status === 'running' && state.pid) {
        return state
    }
    return null
}
