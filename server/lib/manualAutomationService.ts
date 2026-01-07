import { EventEmitter } from 'events';
import { spawn, ChildProcess, execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { Profile, profileManager } from './profiles.js';
import { registerCleanup } from './shutdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

class ManualAutomationService extends EventEmitter {
    private _processes = new Map<string, ChildProcess>();
    private _runningNames = new Set<string>();
    private _stopping = new Set<string>(); // Track profiles being stopped to suppress errors

    constructor() {
        super();
        registerCleanup(() => this.stopAll());
    }

    get runningNames() { return this._runningNames; }

    async start(profile: Profile) {
        const name = profile.name;
        if (this._processes.has(name)) return;

        const scriptPath = path.join(PROJECT_ROOT, 'python', 'launcher.py');
        const args = ['--name', name];
        if (profile.proxy) args.push('--proxy', profile.proxy);
        args.push('--action', 'manual');
        if (profile.fingerprint_seed) args.push('--fingerprint-seed', profile.fingerprint_seed);
        if (profile.fingerprint_os) args.push('--fingerprint-os', profile.fingerprint_os);

        try {
            const python = process.env.PYTHON || 'python';
            const child = spawn(python, [scriptPath, ...args], {
                cwd: PROJECT_ROOT,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: process.platform === 'win32',
                env: { ...process.env, PYTHONUNBUFFERED: '1' },
            });

            if (child.stdout) {
                child.stdout.on('data', (data) => this.emit('log', { name, message: data.toString() }));
            }
            if (child.stderr) {
                child.stderr.on('data', (data) => this.emit('log', { name, message: data.toString() }));
            }

            this._processes.set(name, child);
            this._runningNames.add(name);
            this.emit('change', this._runningNames);
            void profileManager.syncProfileStatus(name, 'running', true);

            child.on('exit', () => {
                this._stopping.delete(name);
                this._processes.delete(name);
                this._runningNames.delete(name);
                this.emit('change', this._runningNames);
                void profileManager.syncProfileStatus(name, 'idle', false);
            });

            child.on('error', (err) => {
                // Only emit error if not intentionally stopping
                if (!this._stopping.has(name)) {
                    this.emit('error', { name, message: err.message });
                }
                this._stopping.delete(name);
                this._processes.delete(name);
                this._runningNames.delete(name);
                this.emit('change', this._runningNames);
                void profileManager.syncProfileStatus(name, 'idle', false);
            });
        } catch (e: any) {
            this.emit('error', { name, message: e.message });
            throw e;
        }
    }

    stop(name: string) {
        const proc = this._processes.get(name);
        if (proc) {
            try {
                // Mark as stopping to suppress error events
                this._stopping.add(name);

                // Remove listeners to prevent error spam during shutdown
                proc.stdout?.removeAllListeners('data');
                proc.stderr?.removeAllListeners('data');

                void this.stopAsync(name, proc);
            } catch {
                // Process may already be dead, clean up anyway
                this._processes.delete(name);
                this._runningNames.delete(name);
                this.emit('change', this._runningNames);
            }
        }
    }

    private async stopAsync(name: string, proc: ChildProcess): Promise<void> {
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
            await this.waitForExit(proc, 5000);
            this._stopping.delete(name);
        }
    }

    async stopAll(): Promise<void> {
        const entries = Array.from(this._processes.entries());
        await Promise.all(entries.map(([name, proc]) => this.stopAsync(name, proc)));
    }

    private waitForExit(proc: ChildProcess, ms: number): Promise<boolean> {
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

    isRunning(name: string) {
        return this._runningNames.has(name);
    }
}

export const manualAutomationService = new ManualAutomationService();
