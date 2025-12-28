import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateSettings } from '../lib/validation/settingsSchema.js';
import { DEFAULT_SETTINGS } from '../types/index.js';

describe('Settings Validation', () => {
    it('should pass for default settings', () => {
        const result = validateSettings(DEFAULT_SETTINGS);
        assert.ok(!(result instanceof Error));
    });

    it('should fail for non-object', () => {
        const result = validateSettings(null);
        assert.ok(result instanceof Error);
        assert.strictEqual(result.message, 'Settings must be an object');
    });

    it('should fail for out of range values', () => {
        const bad = { ...DEFAULT_SETTINGS, max_sessions: 101 };
        const result = validateSettings(bad);
        assert.ok(result instanceof Error);
        assert.ok(result.message.includes('max_sessions must be between 1 and 100'));
    });

    it('should fail for invalid actions in order', () => {
        const bad = { ...DEFAULT_SETTINGS, action_order: ['InvalidAction' as any] };
        const result = validateSettings(bad);
        assert.ok(result instanceof Error);
        assert.ok(result.message.includes('Invalid action in order: InvalidAction'));
    });

    it('should report multiple errors with bullet formatting', () => {
        const bad: any = { ...DEFAULT_SETTINGS };
        delete bad.automation_enabled;
        bad.headless = 'nope';
        bad.max_sessions = '3';
        bad.source_list_ids = 'not array';
        bad.action_order = 'not array';

        const result = validateSettings(bad);
        assert.ok(result instanceof Error);
        assert.ok(result.message.startsWith('Validation failed:\n- '));
        assert.ok(result.message.includes('automation_enabled must be boolean'));
        assert.ok(result.message.includes('headless must be boolean'));
        assert.ok(result.message.includes('max_sessions must be a number'));
        assert.ok(result.message.includes('source_list_ids must be an array'));
        assert.ok(result.message.includes('action_order must be an array'));
    });
});
