import { describe, it } from 'node:test';
import assert from 'node:assert';
import { appendLog, getLogs, clearLogs, subscribeLogs } from '../lib/logStore.js';

describe('logStore', () => {
    it('should bound the number of logs', () => {
        clearLogs();
        const MAX = 1000;
        for (let i = 0; i < MAX + 10; i++) {
            appendLog(`log ${i}`);
        }
        const logs = getLogs();
        assert.strictEqual(logs.length, MAX);
        assert.strictEqual(logs[0]?.message, 'log 10');
        assert.strictEqual(logs[MAX - 1]?.message, 'log 1009');
    });

    it('should notify subscribers on append and clear', () => {
        clearLogs();
        let appended = 0;
        let cleared = 0;

        const unsub = subscribeLogs(() => { appended++; }, () => { cleared++; });

        appendLog('a');
        appendLog('b');
        clearLogs();

        unsub();
        appendLog('c');
        clearLogs();

        assert.strictEqual(appended, 2);
        assert.strictEqual(cleared, 1);
        assert.strictEqual(getLogs().length, 0);
    });
});
