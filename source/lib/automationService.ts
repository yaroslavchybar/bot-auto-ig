import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process';
import { EventEmitter } from 'events';
import { appendLog } from './logStore.js';
import { registerCleanup } from './shutdown.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'scripts', 'instagram_automation.py');

export type AutomationStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export class AutomationService extends EventEmitter {
    private process: ChildProcessWithoutNullStreams | null = null;
    private _status: AutomationStatus = 'idle';
    private _error: string | null = null;
    private stdoutBuffer = '';
    private stderrBuffer = '';
    private exitPromise: Promise<number | null> | null = null;

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
                env: { ...process.env, PYTHONUNBUFFERED: '1' },
                detached: process.platform === 'win32',
            });
        } catch (e: any) {
            this._error = e?.message || String(e);
            this.setStatus('error');
            appendLog(`Automation failed to spawn: ${this._error}`, 'automation');
            return;
        }

        this.setStatus('running');

        const proc = this.process;
        this.stdoutBuffer = '';
        this.stderrBuffer = '';
        this.exitPromise = new Promise<number | null>((resolve) => {
            proc.once('exit', (code) => resolve(code));
            proc.once('error', () => resolve(null));
        });

        proc.stdout.on('data', (chunk) => {
            this.stdoutBuffer += chunk.toString('utf8');

            while (true) {
                const startIdx = this.stdoutBuffer.indexOf('__EVENT__');
                if (startIdx === -1) {
                    const lastNewline = this.stdoutBuffer.lastIndexOf('\n');
                    if (lastNewline === -1) return;
                    const complete = this.stdoutBuffer.slice(0, lastNewline + 1);
                    this.stdoutBuffer = this.stdoutBuffer.slice(lastNewline + 1);
                    const lines = complete.split(/\r?\n/).filter(Boolean);
                    for (const line of lines) appendLog(line, 'ig');
                    return;
                }

                const before = this.stdoutBuffer.slice(0, startIdx);
                const lastNewline = before.lastIndexOf('\n');
                if (lastNewline !== -1) {
                    const complete = this.stdoutBuffer.slice(0, lastNewline + 1);
                    this.stdoutBuffer = this.stdoutBuffer.slice(lastNewline + 1);
                    const lines = complete.split(/\r?\n/).filter(Boolean);
                    for (const line of lines) appendLog(line, 'ig');
                    continue;
                }

                if (before.length > 0) {
                    const trimmed = before.replace(/\r?\n$/, '');
                    if (trimmed.trim().length > 0) appendLog(trimmed.trimEnd(), 'ig');
                    this.stdoutBuffer = this.stdoutBuffer.slice(startIdx);
                    continue;
                }

                const endIdx = this.stdoutBuffer.indexOf('__EVENT__', startIdx + '__EVENT__'.length);
                if (endIdx === -1) return;

                const jsonText = this.stdoutBuffer.slice(startIdx + '__EVENT__'.length, endIdx);
                const afterIdx = endIdx + '__EVENT__'.length;
                this.stdoutBuffer = this.stdoutBuffer.slice(afterIdx);
                if (this.stdoutBuffer.startsWith('\r\n')) this.stdoutBuffer = this.stdoutBuffer.slice(2);
                else if (this.stdoutBuffer.startsWith('\n')) this.stdoutBuffer = this.stdoutBuffer.slice(1);

                try {
                    const event = JSON.parse(jsonText);
                    this.emit('event', event);
                } catch {
                    appendLog(`Failed to parse event: __EVENT__${jsonText}__EVENT__`, 'trace');
                }
            }
        });

        proc.stderr.on('data', (chunk) => {
            this.stderrBuffer += chunk.toString('utf8');
            const lastNewline = this.stderrBuffer.lastIndexOf('\n');
            if (lastNewline === -1) return;
            const complete = this.stderrBuffer.slice(0, lastNewline + 1);
            this.stderrBuffer = this.stderrBuffer.slice(lastNewline + 1);
            const lines = complete.split(/\r?\n/).filter(Boolean);
            for (const line of lines) appendLog(line, 'ig:err');
        });

        proc.on('exit', (code) => {
            this.process = null;
            this.exitPromise = null;
            if (this._status !== 'stopping') {
                if (code === 0) {
                    this.setStatus('idle');
                } else {
                    this._error = `Automation crashed with code ${code}`;
                    this.setStatus('error');
                }
                appendLog(`Automation exited unexpectedly with code ${code}`, 'automation');
            } else {
                appendLog('Automation stopped.', 'automation');
                this.setStatus('idle');
            }
            this.emit('exit', code);
        });

        proc.on('error', (err) => {
            this._error = err.message;
            this.process = null;
            this.exitPromise = null;
            this.setStatus('error');
            appendLog(`Automation error: ${this._error}`, 'automation');
        });

        const payload = JSON.stringify({ settings });
        proc.stdin.write(payload);
        proc.stdin.end();
    }

    async stop(): Promise<void> {
        const proc = this.process;
        if (!proc) return;
        this.setStatus('stopping');
        appendLog('Stopping automation...', 'automation');

        const exitPromise = this.exitPromise;

        try {
            if (process.platform === 'win32') {
                try { proc.kill('SIGBREAK'); } catch { }
                const exited = await this.waitForExit(proc, 1500);
                if (!exited) {
                    try { proc.kill(); } catch { }
                }
                const exited2 = await this.waitForExit(proc, 1500);
                if (!exited2 && typeof proc.pid === 'number') {
                    await this.taskkillTree(proc.pid);
                }
            } else {
                try { proc.kill('SIGTERM'); } catch { }
                const exited = await this.waitForExit(proc, 2000);
                if (!exited) {
                    try { proc.kill('SIGKILL'); } catch { }
                }
            }
        } finally {
            if (exitPromise) await exitPromise;
        }
    }

    private waitForExit(proc: ChildProcessWithoutNullStreams, ms: number): Promise<boolean> {
        if (proc.exitCode !== null) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                proc.off('exit', onExit);
                resolve(proc.exitCode !== null);
            }, ms);
            const onExit = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(true);
            };
            proc.once('exit', onExit);
        });
    }

    private taskkillTree(pid: number): Promise<void> {
        return new Promise<void>((resolve) => {
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
        });
    }
}

export const automationService = new AutomationService();
