type CleanupFn = () => void | Promise<void>;
const cleanupFns = new Set<CleanupFn>();

export function registerCleanup(fn: CleanupFn): () => void {
    cleanupFns.add(fn);
    return () => cleanupFns.delete(fn);
}

export function initShutdownHandler(): void {
    const cleanup = async () => {
        for (const fn of cleanupFns) {
            try {
                await fn();
            } catch (err) {
                // Prevent errors in cleanup from blocking other cleanups
                console.error('Cleanup function failed:', err);
            }
        }
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}
