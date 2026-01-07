import { EventEmitter } from 'events';
import { listsList } from './convex.js';
import { ListRow } from '../types/index.js';

export class ListsService extends EventEmitter {
    private _lists: ListRow[] = [];
    private _loading = false;
    private _error: string | null = null;

    constructor(private fetcher = listsList) {
        super();
    }

    get lists() { return this._lists; }
    get isLoading() { return this._loading; }
    get error() { return this._error; }

    async refresh() {
        this._loading = true;
        this._error = null;
        this.emit('loadingChange', true);
        try {
            const data = await this.fetcher();
            this._lists = (data as any) || [];
            this.emit('change', this._lists);
        } catch (e: any) {
            this._error = e?.message || String(e);
            this.emit('error', this._error);
        } finally {
            this._loading = false;
            this.emit('loadingChange', false);
        }
    }
}

export const listsService = new ListsService();
