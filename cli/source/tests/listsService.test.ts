import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ListsService } from '../lib/listsService.js';

describe('ListsService', () => {
    it('should emit change on successful refresh', async (t) => {
        const mockData = [{ id: '1', name: 'Test List' }];
        const service = new ListsService(async () => mockData);

        let emittedData: any = null;
        service.on('change', (d) => { emittedData = d; });

        await service.refresh();

        assert.deepStrictEqual(emittedData, mockData);
        assert.deepStrictEqual(service.lists, mockData);
    });

    it('should emit error on failed refresh', async (t) => {
        const errorMsg = 'Failed to fetch';
        const service = new ListsService(async () => { throw new Error(errorMsg); });

        let emittedError: string | null = null;
        service.on('error', (e) => { emittedError = e; });

        await service.refresh();

        assert.strictEqual(emittedError, errorMsg);
        assert.strictEqual(service.error, errorMsg);
    });

    it('should emit loadingChange true then false around refresh', async () => {
        const service = new ListsService(async () => [{ id: '1', name: 'Test List' }]);
        const states: boolean[] = [];
        service.on('loadingChange', (s) => states.push(Boolean(s)));

        await service.refresh();

        assert.deepStrictEqual(states, [true, false]);
        assert.strictEqual(service.isLoading, false);
        assert.strictEqual(service.error, null);
    });

    it('should treat null fetch results as an empty list', async () => {
        const service = new ListsService(async () => null as any);
        await service.refresh();
        assert.deepStrictEqual(service.lists, []);
    });
});
