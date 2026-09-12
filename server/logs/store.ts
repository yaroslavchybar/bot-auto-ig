import { LogEntry, LogLevel } from '../shared/types.js';

// In-memory ring buffer only. Logs are never persisted to disk:
// they stream to connected clients over websocket and live until
// the process restarts (or DELETE /api/logs clears them).

const MAX_LOG_ENTRIES = 1000;

let logs: LogEntry[] = [];

function trimLogs() {
	if (logs.length > MAX_LOG_ENTRIES) {
		logs = logs.slice(-MAX_LOG_ENTRIES);
	}
}


type Subscriber = {
	onAppend?: () => void;
	onClear?: () => void;
};

const subscribers = new Set<Subscriber>();

export function getLogs(): LogEntry[] {
	return logs;
}

type LogMeta = Partial<Pick<LogEntry, 'workflowId' | 'taskId' | 'targetUsername' | 'errorCode' | 'outcome' | 'attempt' | 'diagnostics'>>

export function appendLog(
	message: string,
	source?: string,
	level: LogLevel = 'info',
	profileName?: string,
	meta: LogMeta = {},
): void {
	const entry: LogEntry = { ts: Date.now(), message, source, level, profileName, ...meta };
	logs.push(entry);
	trimLogs();

	for (const s of subscribers) s.onAppend?.();
}

export function clearLogs(): void {
	logs = [];
	for (const s of subscribers) s.onClear?.();
}

export function subscribeLogs(onAppend?: () => void, onClear?: () => void): () => void {
	const sub: Subscriber = { onAppend, onClear };
	subscribers.add(sub);
	return () => {
		subscribers.delete(sub);
	};
}
