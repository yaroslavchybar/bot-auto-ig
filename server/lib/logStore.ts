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

const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const BACKUP_COUNT = 5;
let writeQueue = Promise.resolve();

async function rotateLogFileIfNeeded() {
	try {
		const stats = await fs.promises.stat(currentLogFile);
		if (stats.size < MAX_LOG_FILE_SIZE) return;

		// Rotate
		for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
			const oldFile = `${currentLogFile}.${i}`;
			const newFile = `${currentLogFile}.${i + 1}`;
			try {
				await fs.promises.rename(oldFile, newFile);
			} catch {}
		}

		try {
			await fs.promises.rename(currentLogFile, `${currentLogFile}.1`);
		} catch {}
	} catch {
		// file might not exist yet
	}
}

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
	
	writeQueue = writeQueue.then(async () => {
		await rotateLogFileIfNeeded();
		await fs.promises.appendFile(currentLogFile, line);
	}).catch(() => {
		// Ignore errors
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
