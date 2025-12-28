import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { appendLog } from './logStore.js';
import { registerCleanup } from './shutdown.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'cli', 'scripts', 'instagram_automation.py');

export type AutomationStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export class AutomationService extends EventEmitter {
    private process: ChildProcessWithoutNullStreams | null = null;
    private _status: AutomationStatus = 'idle';
    private _error: string | null = null;

    constructor(private spawnFn = spawn) {
        super();
        registerCleanup(() => this.stop());
    }

    get status(): AutomationStatus { return this._status; }
    get error(): string | null { return this._error; }
    get isRunning(): boolean { return this._status === 'running' || this._status === 'starting'; }

    private setStatus(status: AutomationStatus) {
        this._status = status;
        this.emit('statusChange', status);
    }

    async start(settings: any): Promise<void> {
        if (this.isRunning) return;

        this._error = null;
        this.setStatus('starting');
        appendLog('Starting Instagram automation...', 'automation');

        const python = process.env.PYTHON || 'python';
        try {
            this.process = this.spawnFn(python, [PYTHON_RUNNER], {
                cwd: PROJECT_ROOT,
                stdio: 'pipe',
                env: { ...process.env, PYTHONUNBUFFERED: '1' }
            });
        } catch (e: any) {
            this._error = e?.message || String(e);
            this.setStatus('error');
            appendLog(`Automation failed to spawn: ${this._error}`, 'automation');
            return;
        }

        this.setStatus('running');

        this.process.stdout.on('data', (chunk) => {
            const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
                const eventMatch = line.match(/__EVENT__(.+?)__EVENT__/);
                if (eventMatch && eventMatch[1]) {
                    try {
                        const event = JSON.parse(eventMatch[1]);
                        this.emit('event', event);
                    } catch (e) {
                        appendLog(`Failed to parse event: ${line}`, 'trace');
                    }
                } else {
                    appendLog(line, 'ig');
                }
            }
        });

        this.process.stderr.on('data', (chunk) => {
            const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
            for (const line of lines) appendLog(line, 'ig:err');
        });

        this.process.on('exit', (code) => {
            this.process = null;
            if (this._status !== 'stopping') {
                appendLog(`Automation exited unexpectedly with code ${code}`, 'automation');
            } else {
                appendLog('Automation stopped.', 'automation');
            }
            this.setStatus('idle');
            this.emit('exit', code);
        });

        this.process.on('error', (err) => {
            this._error = err.message;
            this.process = null;
            this.setStatus('error');
            appendLog(`Automation error: ${this._error}`, 'automation');
        });

        const payload = JSON.stringify({ settings });
        this.process.stdin.write(payload);
        this.process.stdin.end();
    }

    async stop(): Promise<void> {
        if (!this.process) return;
        this.setStatus('stopping');
        appendLog('Stopping automation...', 'automation');
        this.process.kill();
        // Wait for exit or force kill? For now just kill and let 'exit' handler do the rest
    }
}

export const automationService = new AutomationService();
