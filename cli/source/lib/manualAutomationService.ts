import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { Profile, profileManager } from './profiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

class ManualAutomationService extends EventEmitter {
    private _processes = new Map<string, ChildProcess>();
    private _runningNames = new Set<string>();

    get runningNames() { return this._runningNames; }

    async start(profile: Profile) {
        const name = profile.name;
        if (this._processes.has(name)) return;

        const scriptPath = path.join(PROJECT_ROOT, 'launcher.py');
        const args = ['--name', name];
        if (profile.proxy) args.push('--proxy', profile.proxy);
        args.push('--action', 'manual');
        if (profile.user_agent) args.push('--user-agent', profile.user_agent);

        try {
            const python = process.env.PYTHON || 'python';
            const child = spawn(python, [scriptPath, ...args], {
                cwd: PROJECT_ROOT,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false
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
                this._processes.delete(name);
                this._runningNames.delete(name);
                this.emit('change', this._runningNames);
                void profileManager.syncProfileStatus(name, 'idle', false);
            });

            child.on('error', (err) => {
                this.emit('error', { name, message: err.message });
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
            proc.kill();
        }
    }

    isRunning(name: string) {
        return this._runningNames.has(name);
    }
}

export const manualAutomationService = new ManualAutomationService();
