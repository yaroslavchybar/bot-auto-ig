import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MessagesService } from '../lib/messagesService.js';
import { clearLogs, getLogs } from '../lib/logStore.js';

describe('MessagesService', () => {
    it('should fetch templates and emit change', async (t) => {
        const mockLines = ['hello', 'world'];
        const service = new MessagesService(async () => mockLines);

        let emitted: any = null;
        service.on('change', (data) => { emitted = data; });

        await service.fetchTemplates('message');

        assert.deepStrictEqual(emitted, { kind: 'message', lines: mockLines });
        assert.deepStrictEqual(service.templates.message, mockLines);
    });

    it('should save templates and emit change', async (t) => {
        clearLogs();
        const linesToSave = ['new message'];
        const service = new MessagesService(undefined, async () => true as const);

        let emitted: any = null;
        service.on('change', (data) => { emitted = data; });

        await service.saveTemplates('message_2', linesToSave);

        assert.deepStrictEqual(emitted, { kind: 'message_2', lines: linesToSave });
        assert.deepStrictEqual(service.templates.message_2, linesToSave);
        const logs = getLogs();
        assert.ok(logs.some(l => l.source === 'instagram' && l.message.includes('Saved 1 message templates (message_2)')));
    });

    it('should filter empty lines and coerce values to strings', async () => {
        const service = new MessagesService(async () => ['  ', 'hi', 123 as any, '', ' there ']);
        await service.fetchTemplates('message');
        assert.deepStrictEqual(service.templates.message, ['hi', '123', ' there ']);
    });

    it('should treat non-array fetch results as empty', async () => {
        const service = new MessagesService(async () => ({ not: 'an array' } as any));
        await service.fetchTemplates('message');
        assert.deepStrictEqual(service.templates.message, []);
    });

    it('should emit loadingChange true then false on fetch', async () => {
        const service = new MessagesService(async () => []);
        const states: boolean[] = [];
        service.on('loadingChange', (s) => states.push(Boolean(s)));
        await service.fetchTemplates('message');
        assert.deepStrictEqual(states, [true, false]);
    });

    it('should emit error and clear loading on fetch failure', async () => {
        const service = new MessagesService(async () => { throw new Error('boom'); });
        const states: boolean[] = [];
        let err: string | null = null;
        service.on('loadingChange', (s) => states.push(Boolean(s)));
        service.on('error', (e) => { err = e; });

        await service.fetchTemplates('message');

        assert.deepStrictEqual(states, [true, false]);
        assert.strictEqual(err, 'boom');
        assert.strictEqual(service.error, 'boom');
    });

    it('should emit error and rethrow on save failure', async () => {
        const service = new MessagesService(undefined, async () => { throw new Error('save failed'); });
        let err: string | null = null;
        service.on('error', (e) => { err = e; });

        await assert.rejects(() => service.saveTemplates('message', ['x']), /save failed/);
        assert.strictEqual(err, 'save failed');
        assert.strictEqual(service.error, 'save failed');
    });
});
