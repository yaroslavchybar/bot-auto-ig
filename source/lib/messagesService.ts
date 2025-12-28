import { EventEmitter } from 'events';
import { messageTemplatesGet, messageTemplatesUpsert } from './supabase.js';
import { appendLog } from './logStore.js';

export class MessagesService extends EventEmitter {
    private _templates: Record<string, string[]> = {
        'message': [],
        'message_2': []
    };
    private _loading = false;
    private _error: string | null = null;

    constructor(
        private fetcher = messageTemplatesGet,
        private saver = messageTemplatesUpsert
    ) {
        super();
    }

    get templates() { return this._templates; }
    get isLoading() { return this._loading; }
    get error() { return this._error; }

    async fetchTemplates(kind: 'message' | 'message_2') {
        this._loading = true;
        this._error = null;
        this.emit('loadingChange', true);
        try {
            const texts = await this.fetcher(kind);
            const lines = Array.isArray(texts)
                ? texts.filter((t: any) => String(t).trim()).map((t: any) => String(t))
                : [];
            this._templates[kind] = lines;
            this.emit('change', { kind, lines });
        } catch (e: any) {
            this._error = e?.message || String(e);
            this.emit('error', this._error);
        } finally {
            this._loading = false;
            this.emit('loadingChange', false);
        }
    }

    async saveTemplates(kind: 'message' | 'message_2', lines: string[]) {
        this._error = null;
        try {
            await this.saver(kind, lines);
            this._templates[kind] = lines;
            appendLog(`Saved ${lines.length} message templates (${kind})`, 'instagram');
            this.emit('change', { kind, lines });
        } catch (e: any) {
            this._error = e?.message || String(e);
            this.emit('error', this._error);
            throw e;
        }
    }
}

export const messagesService = new MessagesService();
