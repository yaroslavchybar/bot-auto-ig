import { describe, it } from 'node:test';
import assert from 'node:assert';
import { clamp, nextPercent, toFloat, toInt } from '../lib/utils.js';

describe('utils', () => {
    it('clamp should bound values between min and max', () => {
        assert.strictEqual(clamp(-1, 0, 10), 0);
        assert.strictEqual(clamp(0, 0, 10), 0);
        assert.strictEqual(clamp(5, 0, 10), 5);
        assert.strictEqual(clamp(11, 0, 10), 10);
    });

    it('toInt should parse integers or return fallback', () => {
        assert.strictEqual(toInt(' 42 ', 0), 42);
        assert.strictEqual(toInt('42px', 0), 42);
        assert.strictEqual(toInt('nope', 7), 7);
        assert.strictEqual(toInt('', 7), 7);
    });

    it('toFloat should parse floats or return fallback', () => {
        assert.strictEqual(toFloat(' 1.5 ', 0), 1.5);
        assert.strictEqual(toFloat('2', 0), 2);
        assert.strictEqual(toFloat('nope', 7), 7);
        assert.strictEqual(toFloat('', 7), 7);
    });

    it('nextPercent should step by 10 and stay within 0..100', () => {
        assert.strictEqual(nextPercent(0, -1), 0);
        assert.strictEqual(nextPercent(0, 1), 10);
        assert.strictEqual(nextPercent(7, 1), 20);
        assert.strictEqual(nextPercent(99, 1), 100);
        assert.strictEqual(nextPercent(100, -1), 90);
    });
});

