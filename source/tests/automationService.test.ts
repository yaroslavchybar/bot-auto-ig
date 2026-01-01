import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AutomationService } from '../lib/automationService.js';
import { EventEmitter } from 'events';
import { clearLogs, getLogs } from '../lib/logStore.js';

function createMockProcess() {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.exitCode = null;
    mockProcess.pid = 12345;
    const originalEmit = mockProcess.emit.bind(mockProcess);
    mockProcess.emit = (event: string, ...args: any[]) => {
        if (event === 'exit') {
            mockProcess.exitCode = args[0] ?? 0;
        }
        return originalEmit(event, ...args);
    };
    const stdinWrites: string[] = [];
    mockProcess.stdin = {
        write: (payload: any) => { stdinWrites.push(String(payload)); },
        end: () => { }
    };
    mockProcess.kill = () => { mockProcess.emit('exit', 0); };
    return { mockProcess, stdinWrites };
}

describe('AutomationService (Expanded)', () => {
    it('should parse structured events from stdout', async () => {
        clearLogs();
        const { mockProcess } = createMockProcess();

        const mockSpawn = () => mockProcess;
        const service = new AutomationService(mockSpawn as any);

        let receivedEvent: any = null;
        service.on('event', (e) => { receivedEvent = e; });

        await service.start({ source_list_ids: [] });

        // Simulate Python output
        const eventData = { type: 'profile_started', profile: 'test_user' };
        const line = `__EVENT__${JSON.stringify(eventData)}__EVENT__\n`;
        mockProcess.stdout.emit('data', Buffer.from(line));

        assert.deepStrictEqual(receivedEvent, eventData);

        await service.stop();
    });

    it('should parse events split across stdout chunks', async () => {
        clearLogs();
        const { mockProcess } = createMockProcess();

        const service = new AutomationService((() => mockProcess) as any);

        let receivedEvent: any = null;
        service.on('event', (e) => { receivedEvent = e; });

        await service.start({ source_list_ids: [] });

        const eventData = { type: 'profile_started', profile: 'test_user' };
        const line = `__EVENT__${JSON.stringify(eventData)}__EVENT__\n`;

        mockProcess.stdout.emit('data', Buffer.from(line.slice(0, 12)));
        mockProcess.stdout.emit('data', Buffer.from(line.slice(12)));

        assert.deepStrictEqual(receivedEvent, eventData);
        await service.stop();
    });

    it('should ignore non-event lines and log them as ig', async () => {
        clearLogs();
        const { mockProcess } = createMockProcess();
        const service = new AutomationService((() => mockProcess) as any);

        await service.start({ source_list_ids: [] });
        mockProcess.stdout.emit('data', Buffer.from('hello world\n'));

        const logs = getLogs();
        assert.ok(logs.some(l => l.source === 'ig' && l.message === 'hello world'));
        await service.stop();
    });

    it('should record parse failures as trace logs', async () => {
        clearLogs();
        const { mockProcess } = createMockProcess();
        const service = new AutomationService((() => mockProcess) as any);

        await service.start({ source_list_ids: [] });
        mockProcess.stdout.emit('data', Buffer.from('__EVENT__{bad json}__EVENT__\n'));

        const logs = getLogs();
        assert.ok(logs.some(l => l.source === 'trace' && l.message.includes('Failed to parse event:')));
        await service.stop();
    });

    it('should log stderr lines as ig:err', async () => {
        clearLogs();
        const { mockProcess } = createMockProcess();
        const service = new AutomationService((() => mockProcess) as any);

        await service.start({ source_list_ids: [] });
        mockProcess.stderr.emit('data', Buffer.from('oops\n'));

        const logs = getLogs();
        assert.ok(logs.some(l => l.source === 'ig:err' && l.message === 'oops'));
        await service.stop();
    });

    it('should set status to error and log when spawn throws', async () => {
        clearLogs();
        const spawnErr = new Error('spawn failed');
        const service = new AutomationService((() => { throw spawnErr; }) as any);

        const states: string[] = [];
        service.on('statusChange', (s) => states.push(String(s)));

        await service.start({ source_list_ids: [] });

        assert.strictEqual(service.status, 'error');
        assert.strictEqual(service.error, 'spawn failed');
        assert.ok(states.includes('starting'));
        assert.ok(states.includes('error'));
        assert.ok(getLogs().some(l => l.source === 'automation' && l.message.includes('Automation failed to spawn: spawn failed')));
    });

    it('should emit exit and enter error after unexpected exit', async () => {
        clearLogs();
        const { mockProcess } = createMockProcess();
        const service = new AutomationService((() => mockProcess) as any);

        let exitCode: number | null = null;
        service.on('exit', (code) => { exitCode = code; });

        await service.start({ source_list_ids: [] });
        mockProcess.emit('exit', 2);

        assert.strictEqual(exitCode, 2);
        assert.strictEqual(service.status, 'error');
        assert.ok((service.error || '').includes('code 2'));
        assert.ok(getLogs().some(l => l.source === 'automation' && l.message.includes('exited unexpectedly with code 2')));
    });

    it('should write settings payload to stdin', async () => {
        const { mockProcess, stdinWrites } = createMockProcess();
        const service = new AutomationService((() => mockProcess) as any);

        const settings = { source_list_ids: ['a'], max_sessions: 3 };
        await service.start(settings);

        assert.strictEqual(stdinWrites.length, 1);
        const parsed = JSON.parse(stdinWrites[0]);
        assert.deepStrictEqual(parsed, { settings });

        await service.stop();
    });

    it('should not spawn twice when already running', async () => {
        const { mockProcess } = createMockProcess();
        let calls = 0;
        const service = new AutomationService((() => { calls++; return mockProcess; }) as any);

        await service.start({ source_list_ids: [] });
        await service.start({ source_list_ids: [] });

        assert.strictEqual(calls, 1);
        await service.stop();
    });
});
