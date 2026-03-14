/**
 * PID Manager — Thin re-export from shared/ProcessService.
 *
 * All process-spawning, killing, and PID-tracking logic now lives
 * in shared/ProcessService.ts. This module preserves the import
 * paths consumed by automation/routes.ts and index.ts.
 */
export {
    savePid,
    clearPid,
    getSavedPid,
    cleanupOrphanedProcesses,
} from '../shared/ProcessService.js'
