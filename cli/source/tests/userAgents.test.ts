import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getRandomUserAgent } from '../lib/user_agents.js';

describe('user_agents', () => {
    it('should select from the requested browser list', () => {
        const originalRandom = Math.random;
        (Math as any).random = () => 0;
        try {
            const ua = getRandomUserAgent(undefined, 'Chrome');
            assert.ok(ua.includes('Chrome/'));
        } finally {
            (Math as any).random = originalRandom;
        }
    });

    it('should filter by OS when possible', () => {
        const originalRandom = Math.random;
        (Math as any).random = () => 0;
        try {
            const ua = getRandomUserAgent('Linux', 'Chrome');
            assert.ok(ua.includes('Linux') || ua.includes('X11'));
        } finally {
            (Math as any).random = originalRandom;
        }
    });

    it('should fall back when OS filter yields no candidates', () => {
        const originalRandom = Math.random;
        (Math as any).random = () => 0;
        try {
            const ua = getRandomUserAgent('Windows', 'Safari');
            assert.ok(ua.includes('Safari/'));
        } finally {
            (Math as any).random = originalRandom;
        }
    });

    it('should default to Firefox candidates for unknown browser', () => {
        const originalRandom = Math.random;
        (Math as any).random = () => 0;
        try {
            const ua = getRandomUserAgent('Windows', 'Unknown');
            assert.ok(ua.includes('Firefox/'));
        } finally {
            (Math as any).random = originalRandom;
        }
    });
});

