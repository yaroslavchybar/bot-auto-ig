/**
 * Simple async mutex for protecting critical sections.
 * Prevents race conditions in automation state management.
 */
export class Mutex {
    private locked = false
    private queue: Array<() => void> = []

    /**
     * Acquire the mutex. Returns a release function.
     * If already locked, waits until released.
     */
    async acquire(): Promise<() => void> {
        if (!this.locked) {
            this.locked = true
            return () => this.release()
        }

        return new Promise<() => void>(resolve => {
            this.queue.push(() => {
                resolve(() => this.release())
            })
        })
    }

    private release(): void {
        const next = this.queue.shift()
        if (next) {
            next()
        } else {
            this.locked = false
        }
    }

    /**
     * Check if mutex is currently locked.
     */
    isLocked(): boolean {
        return this.locked
    }
}

// Singleton mutex for automation operations
export const automationMutex = new Mutex()
