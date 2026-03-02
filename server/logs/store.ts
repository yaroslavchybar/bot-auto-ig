import fs from 'node:fs';
import path from 'node:path';
import { LogEntry, LogLevel } from '../types/index.js';

const MAX_LOG_ENTRIES = 1000;
const MAX_LOG_LINES_PER_FILE = 1000;
const cwd = process.cwd();
const PROJECT_ROOT = path.basename(cwd).toLowerCase() === 'server' ? path.resolve(cwd, '..') : cwd;
const LOG_DIR = path.join(PROJECT_ROOT, 'data', 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
	fs.mkdirSync(LOG_DIR, { recursive: true });
}

const sessionDate = new Date().toISOString().replace(/[:.]/g, '-');
const sessionPrefix = `session-${sessionDate}`;
let currentLogPart = 1;
let currentLogLineCount = 0;
let writeQueue = Promise.resolve();

function getSessionLogFile(part: number): string {
	return path.join(LOG_DIR, `${sessionPrefix}-${String(part).padStart(4, '0')}.log`);
}

let currentLogFile = getSessionLogFile(currentLogPart);

async function getFileLineCount(filePath: string): Promise<number> {
	try {
		const raw = await fs.promises.readFile(filePath, 'utf-8');
		if (!raw) return 0;
		const lines = raw.split('\n');
		return raw.endsWith('\n') ? lines.length - 1 : lines.length;
	} catch {
		return 0;
	}
}

async function ensureWritableLogFile() {
	if (currentLogLineCount < MAX_LOG_LINES_PER_FILE) return;

	do {
		currentLogPart += 1;
		currentLogFile = getSessionLogFile(currentLogPart);
		currentLogLineCount = await getFileLineCount(currentLogFile);
	} while (currentLogLineCount >= MAX_LOG_LINES_PER_FILE);
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

export function appendLog(message: string, source?: string, level: LogLevel = 'info', profileName?: string): void {
	const entry: LogEntry = { ts: Date.now(), message, source, level, profileName };
	logs.push(entry);
	trimLogs();

	// Persist to file
	const line = JSON.stringify(entry) + '\n';

	writeQueue = writeQueue.then(async () => {
		await ensureWritableLogFile();
		await fs.promises.appendFile(currentLogFile, line);
		currentLogLineCount += 1;
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
		const safeFilename = path.basename(filename);
		if (safeFilename !== filename || !safeFilename.endsWith('.log')) {
			return [];
		}

		const filePath = path.resolve(LOG_DIR, safeFilename);
		if (!filePath.startsWith(LOG_DIR + path.sep)) {
			return [];
		}

		const content = await fs.promises.readFile(filePath, 'utf-8');
		return content
			.split('\n')
			.filter(line => line.trim())
			.map((line) => {
				try {
					return JSON.parse(line) as LogEntry;
				} catch {
					return null;
				}
			})
			.filter((entry): entry is LogEntry => entry !== null);
	} catch (error) {
		return [];
	}
}
