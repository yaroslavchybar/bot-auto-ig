import React, {useEffect, useMemo, useState} from 'react';
import {Text, Box, useInput} from 'ink';
import {appendLog, clearLogs, getLogs, subscribeLogs} from '../lib/logStore.js';

export default function Logs({onBack}: {onBack: () => void}) {
	const [version, setVersion] = useState(0);
	const [showTime, setShowTime] = useState(false);
	const [showSource, setShowSource] = useState(false);

	useEffect(() => {
		return subscribeLogs(
			() => setVersion(v => v + 1),
			() => setVersion(v => v + 1)
		);
	}, []);

	const logs = useMemo(() => {
		void version;
		return getLogs();
	}, [version]);

	const lines = useMemo(() => {
		const formatted = logs.map(l => {
			if (!showTime && !showSource) return l.message;
			const time = showTime ? new Date(l.ts).toLocaleTimeString() : '';
			const src = showSource && l.source ? ` ${l.source}` : '';
			const prefix = `${time}${src}`.trim();
			return prefix ? `${prefix} ${l.message}` : l.message;
		});
		return formatted.slice(-400);
	}, [logs, showTime, showSource]);

	useInput((input, key) => {
		if (key.escape) {
			onBack();
			return;
		}
		if (input === 'c' || input === 'C') {
			clearLogs();
			appendLog('Logs cleared', 'logs');
		}
		if (input === 't' || input === 'T') {
			setShowTime(v => !v);
		}
		if (input === 's' || input === 'S') {
			setShowSource(v => !v);
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold>Logs</Text>
			<Text color="gray">[Esc] Back  [C] Clear  [T] Toggle time  [S] Toggle source</Text>
			
			<Box marginTop={1} borderStyle="single" borderColor="gray" padding={1} height={20}>
				{lines.length === 0 ? (
					<Text color="gray">No logs yet.</Text>
				) : (
					<Text>{lines.join('\n')}</Text>
				)}
			</Box>
		</Box>
	);
}
