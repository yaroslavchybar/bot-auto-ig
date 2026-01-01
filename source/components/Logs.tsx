import React, {useEffect, useMemo, useState} from 'react';
import {Text, Box, useInput, useStdout} from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import {
	appendLog,
	clearLogs,
	getLogs,
	subscribeLogs,
	getLogFiles,
	loadLogFile
} from '../lib/logStore.js';
import { LogEntry, LogLevel } from '../types/index.js';

const LevelColor: Record<string, string> = {
	info: 'white',
	warn: 'yellow',
	error: 'red',
	success: 'green'
};

const LogRow = ({ entry, showTime, showSource, maxWidth }: { entry: LogEntry, showTime: boolean, showSource: boolean, maxWidth: number }) => {
	const time = showTime ? new Date(entry.ts).toLocaleTimeString() + ' ' : '';
	const src = showSource && entry.source ? `[${entry.source}] ` : '';
	const color = LevelColor[entry.level || 'info'] || 'white';
	
	// Remove timestamp pattern [YYYY-MM-DDTHH:mm:ss+00:00] from message if present
	let cleanMessage = entry.message.replace(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\]\s*/, '');
	
	// Ensure single line by replacing newlines
	cleanMessage = cleanMessage.replace(/[\r\n]+/g, ' ');
	
	return (
		<Text wrap="truncate-end">
			<Text color="gray">{time}</Text>
			<Text color="blue">{src}</Text>
			<Text color={color}>{cleanMessage}</Text>
		</Text>
	);
};

export default function Logs({onBack}: {onBack: () => void}) {
	const {stdout} = useStdout();
	const [viewHeight, setViewHeight] = useState(20);
	const [viewWidth, setViewWidth] = useState(80);

	const [mode, setMode] = useState<'live' | 'browser' | 'static' | 'filter'>('live');
	const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
	const [staticLogs, setStaticLogs] = useState<LogEntry[]>([]);
	const [logFiles, setLogFiles] = useState<{label: string, value: string}[]>([]);
	
	const [filterQuery, setFilterQuery] = useState('');
	const [showTime, setShowTime] = useState(false);
	const [showSource, setShowSource] = useState(false);
	
	const [scrollTop, setScrollTop] = useState(0);
	const [autoScroll, setAutoScroll] = useState(true);

	// Responsive height & width calculation
	useEffect(() => {
		const onResize = () => {
			if (stdout) {
				// Height: Total - header (2) - footer (1) - padding (2) - extra buffer (2)
				const h = Math.max(5, stdout.rows - 7);
				setViewHeight(h);
				// Width: Total columns
				setViewWidth(stdout.columns);
			}
		};
		onResize(); // Initial
		stdout?.on('resize', onResize);
		return () => {
			stdout?.off('resize', onResize);
		};
	}, [stdout]);

	// Initial load & subscription
	useEffect(() => {
		setLiveLogs([...getLogs()]); // Init
		return subscribeLogs(
			() => {
				setLiveLogs([...getLogs()]);
			},
			() => setLiveLogs([])
		);
	}, []);

	// Auto-scroll logic
	const activeLogs = mode === 'static' ? staticLogs : liveLogs;
	const filteredLogs = useMemo(() => {
		if (!filterQuery) return activeLogs;
		const q = filterQuery.toLowerCase();
		return activeLogs.filter(l => 
			l.message.toLowerCase().includes(q) || 
			(l.source && l.source?.toLowerCase().includes(q))
		);
	}, [activeLogs, filterQuery]);

	useEffect(() => {
		if (autoScroll && mode !== 'browser') {
			const maxScroll = Math.max(0, filteredLogs.length - viewHeight);
			setScrollTop(maxScroll);
		}
	}, [filteredLogs.length, autoScroll, mode, viewHeight]);

	// Load files for browser
	useEffect(() => {
		if (mode === 'browser') {
			getLogFiles().then(files => {
				setLogFiles(files.map(f => ({label: f, value: f})));
			});
		}
	}, [mode]);

	useInput((input, key) => {
		// Global Esc
		if (key.escape) {
			if (mode === 'filter') {
				setMode('live');
				return;
			}
			if (mode === 'browser') {
				setMode('live');
				return;
			}
			if (mode === 'static') {
				setMode('live');
				setAutoScroll(true);
				return;
			}
			onBack();
			return;
		}

		// Input handling based on mode
		if (mode === 'filter') {
			if (key.return) {
				setMode(staticLogs.length > 0 ? 'static' : 'live');
			}
			return;
		}

		if (mode === 'browser') {
			// Handled by SelectInput
			return;
		}

		// View Mode (Live/Static) Controls
		if (input === '/') {
			setMode('filter');
			return;
		}
		if (input === 'l' || input === 'L') {
			setMode('browser');
			return;
		}
		if (input === 'c' || input === 'C') {
			if (mode === 'live') {
				clearLogs();
				appendLog('Logs cleared', 'logs', 'info');
			}
		}
		if (input === 't' || input === 'T') setShowTime(v => !v);
		if (input === 's' || input === 'S') setShowSource(v => !v);

		// Scrolling
		if (key.upArrow) {
			setAutoScroll(false);
			setScrollTop(Math.max(0, scrollTop - 1));
		}
		if (key.downArrow) {
			const maxScroll = Math.max(0, filteredLogs.length - viewHeight);
			const next = Math.min(maxScroll, scrollTop + 1);
			setScrollTop(next);
			if (next >= maxScroll) setAutoScroll(true);
		}
		if (key.pageUp) {
			setAutoScroll(false);
			setScrollTop(Math.max(0, scrollTop - viewHeight));
		}
		if (key.pageDown) {
			const maxScroll = Math.max(0, filteredLogs.length - viewHeight);
			const next = Math.min(maxScroll, scrollTop + viewHeight);
			setScrollTop(next);
			if (next >= maxScroll) setAutoScroll(true);
		}
	});

	const handleFileSelect = async (item: {value: string}) => {
		const logs = await loadLogFile(item.value);
		setStaticLogs(logs);
		setMode('static');
		setScrollTop(0);
		setAutoScroll(false);
	};

	const visibleLogs = filteredLogs.slice(scrollTop, scrollTop + viewHeight);
	
	// Calculate safe max width for logs
	// viewWidth - (outer padding * 2) - (inner border * 2) - (inner padding * 2)
	// Padding = 1, so 2 chars per side.
	// 80 - 2 - 2 - 2 = 74 roughly.
	// Let's use viewWidth - 6 to be safe.
	const maxLogWidth = Math.max(10, viewWidth - 8);

	return (
		<Box flexDirection="column" padding={1}>
			<Box>
				<Text bold>Logs</Text>
				<Text color="gray"> | Mode: {mode.toUpperCase()}</Text>
				{filterQuery && <Text color="yellow"> | Filter: "{filterQuery}"</Text>}
				{mode === 'static' && <Text color="cyan"> | Static View</Text>}
			</Box>
			
			{mode === 'filter' && (
				<Box borderStyle="single" borderColor="blue">
					<Text>Filter: </Text>
					<TextInput value={filterQuery} onChange={setFilterQuery} onSubmit={() => setMode(staticLogs.length > 0 ? 'static' : 'live')} />
				</Box>
			)}

			<Box marginTop={1} borderStyle="single" borderColor="gray" padding={1} height={viewHeight + 2}>
				{mode === 'browser' ? (
					logFiles.length === 0 ? (
						<Text color="gray">No log files found.</Text>
					) : (
						<SelectInput items={logFiles} onSelect={handleFileSelect} limit={viewHeight} />
					)
				) : (
					<Box flexDirection="column">
						{visibleLogs.length === 0 ? (
							<Text color="gray">No logs found.</Text>
						) : (
							visibleLogs.map((l, i) => (
								<LogRow 
									key={i} 
									entry={l} 
									showTime={showTime} 
									showSource={showSource} 
									maxWidth={maxLogWidth} 
								/>
							))
						)}
					</Box>
				)}
			</Box>

			<Text color="gray">
				[Esc] Back/Live  [/] Filter  [L] Load File  [C] Clear  [T] Time  [S] Source
			</Text>
		</Box>
	);
}
