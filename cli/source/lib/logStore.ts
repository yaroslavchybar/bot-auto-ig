import { LogEntry } from '../types/index.js';

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

export function appendLog(message: string, source?: string): void {
	const entry: LogEntry = { ts: Date.now(), message, source };
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
