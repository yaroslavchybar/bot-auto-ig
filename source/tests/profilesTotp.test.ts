import { describe, it } from 'node:test';
import assert from 'node:assert';
import { profileManager } from '../lib/profiles.js';

describe('ProfileManager.generateTotp', () => {
    it('should generate a 6-digit code for a valid base32 secret', () => {
        const code = profileManager.generateTotp('JBSWY3DPEHPK3PXP');
        assert.ok(/^\d{6}$/.test(code), `Expected 6 digits, got "${code}"`);
    });

    it('should return Invalid Secret for invalid input', () => {
        const code = profileManager.generateTotp(null as any);
        assert.strictEqual(code, 'Invalid Secret');
    });
});
