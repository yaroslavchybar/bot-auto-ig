import { describe, it } from 'node:test';
import assert from 'node:assert';
import { initShutdownHandler, registerCleanup } from '../lib/shutdown.js';

describe('shutdown', () => {
    it('should allow registering and unregistering cleanup functions', () => {
        const fn = () => { };
        const unregister = registerCleanup(fn);
        assert.strictEqual(typeof unregister, 'function');
        unregister();
    });

    it('should run all cleanup functions on SIGINT and exit with code 0', async () => {
        const prevSigint = process.listeners('SIGINT');
        const prevSigterm = process.listeners('SIGTERM');

        const calls: string[] = [];
        const unregisterA = registerCleanup(() => { calls.push('a'); });
        const unregisterB = registerCleanup(async () => { calls.push('b'); });
        const unregisterC = registerCleanup(() => { calls.push('c'); throw new Error('fail'); });
        const unregisterD = registerCleanup(() => { calls.push('d'); });

        const originalConsoleError = console.error;
        console.error = () => { };

        const originalExit = process.exit;
        let exitCode: number | null = null;
        (process as any).exit = (code: number) => { exitCode = code; };

        initShutdownHandler();

        const nextSigint = process.listeners('SIGINT');
        const nextSigterm = process.listeners('SIGTERM');
        const addedSigint = nextSigint.filter(l => !prevSigint.includes(l));
        const addedSigterm = nextSigterm.filter(l => !prevSigterm.includes(l));

        try {
            process.emit('SIGINT');
            await new Promise<void>((resolve) => setImmediate(resolve));

            assert.strictEqual(exitCode, 0);
            assert.deepStrictEqual(calls, ['a', 'b', 'c', 'd']);
        } finally {
            unregisterA();
            unregisterB();
            unregisterC();
            unregisterD();
            for (const l of addedSigint) process.removeListener('SIGINT', l as any);
            for (const l of addedSigterm) process.removeListener('SIGTERM', l as any);
            (process as any).exit = originalExit;
            console.error = originalConsoleError;
        }
    });
});
