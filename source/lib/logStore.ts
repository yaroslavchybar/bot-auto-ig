import fs from 'node:fs';
import path from 'node:path';
import { LogEntry, LogLevel } from '../types/index.js';

const MAX_LOG_ENTRIES = 1000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOG_DIR = path.join(DATA_DIR, 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
	fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Create session log file
const sessionDate = new Date().toISOString().replace(/[:.]/g, '-');
const currentLogFile = path.join(LOG_DIR, `session-${sessionDate}.log`);

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

export function appendLog(message: string, source?: string, level: LogLevel = 'info'): void {
	const entry: LogEntry = { ts: Date.now(), message, source, level };
	logs.push(entry);
	trimLogs();

	// Persist to file
	const line = JSON.stringify(entry) + '\n';
	fs.appendFile(currentLogFile, line, (err) => {
		if (err) {
			// Fail silently or log to console? Console might mess up TUI.
			// Just ignore for now.
		}
	});

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

export async function getLogFiles(): Promise<string[]> {
	try {
		const files = await fs.promises.readdir(LOG_DIR);
		return files.filter(f => f.endsWith('.log')).sort().reverse();
	} catch (error) {
		return [];
	}
}

export async function loadLogFile(filename: string): Promise<LogEntry[]> {
	try {
		const filePath = path.join(LOG_DIR, filename);
		const content = await fs.promises.readFile(filePath, 'utf-8');
		return content
			.split('\n')
			.filter(line => line.trim())
			.map(line => JSON.parse(line) as LogEntry);
	} catch (error) {
		return [];
	}
}
