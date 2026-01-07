/**
 * Automation Service - connects to the server API for shared state
 * This allows both TUI and web frontend to control the same automation
 */
import { EventEmitter } from 'events';
import { appendLog } from './logStore.js';
import { registerCleanup } from './shutdown.js';
import WebSocket from 'ws';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const WS_URL = SERVER_URL.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws';

export type AutomationStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export class AutomationService extends EventEmitter {
    private _status: AutomationStatus = 'idle';
    private _error: string | null = null;
    private ws: WebSocket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor() {
        super();
        registerCleanup(() => this.disconnect());
        this.connect();
    }

    get status(): AutomationStatus { return this._status; }
    get error(): string | null { return this._error; }
    get isRunning(): boolean { return this._status === 'running' || this._status === 'starting'; }

    private setStatus(status: AutomationStatus) {
        this._status = status;
        this.emit('statusChange', status);
    }

    private connect() {
        if (this.ws) return;

        try {
            this.ws = new WebSocket(WS_URL);

            this.ws.on('open', () => {
                appendLog('Connected to server', 'automation');
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'status') {
                        this.setStatus(msg.status);
                    } else if (msg.type === 'log') {
                        appendLog(msg.message, msg.source || 'server');
                        // Also emit as event for event-based handling
                        if (msg.message?.includes('__EVENT__')) {
                            try {
                                const match = msg.message.match(/__EVENT__(.+?)__EVENT__/);
                                if (match) {
                                    const event = JSON.parse(match[1]);
                                    this.emit('event', event);
                                }
                            } catch { }
                        }
                    }
                } catch { }
            });

            this.ws.on('close', () => {
                this.ws = null;
                // Reconnect after delay
                if (!this.reconnectTimer) {
                    this.reconnectTimer = setTimeout(() => {
                        this.reconnectTimer = null;
                        this.connect();
                    }, 3000);
                }
            });

            this.ws.on('error', () => {
                // Will trigger close event
            });
        } catch (e) {
            // Server might not be running yet
            if (!this.reconnectTimer) {
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectTimer = null;
                    this.connect();
                }, 3000);
            }
        }
    }

    private disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    async fetchStatus(): Promise<void> {
        try {
            const res = await fetch(`${SERVER_URL}/api/automation/status`);
            if (res.ok) {
                const data = await res.json();
                this.setStatus(data.status || 'idle');
            }
        } catch {
            // Server not available
        }
    }

    async start(settings: any): Promise<void> {
        if (this.isRunning) return;

        this._error = null;
        this.setStatus('starting');
        appendLog('Starting Instagram automation...', 'automation');

        try {
            const res = await fetch(`${SERVER_URL}/api/automation/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to start automation');
            }

            this.setStatus('running');
        } catch (e: any) {
            this._error = e?.message || String(e);
            this.setStatus('error');
            appendLog(`Automation failed: ${this._error}`, 'automation');
        }
    }

    async stop(): Promise<void> {
        if (!this.isRunning) return;
        this.setStatus('stopping');
        appendLog('Stopping automation...', 'automation');

        try {
            const res = await fetch(`${SERVER_URL}/api/automation/stop`, {
                method: 'POST'
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to stop automation');
            }
        } catch (e: any) {
            this._error = e?.message || String(e);
            appendLog(`Failed to stop: ${this._error}`, 'automation');
        }
    }
}

export const automationService = new AutomationService();
