import React, { useState } from 'react';
import { Text, Box, useApp, useStdout } from 'ink';
import SelectInput from 'ink-select-input';
import Profiles from './components/profiles/index.js';
import Instagram from './components/instagram/index.js';
import Lists from './components/lists/index.js';
import Logs from './components/Logs.js';

type Props = {
	name?: string;
};

const items = [
	{
		label: 'Profiles Manager',
		value: 'profiles',
	},
	{
		label: 'Instagram Automation',
		value: 'instagram',
	},
	{
		label: 'Lists Manager',
		value: 'lists',
	},
	{
		label: 'Logs',
		value: 'logs',
	},
	{
		label: 'Exit',
		value: 'exit',
	},
];

export default function App({ name = 'User' }: Props) {
	const { exit } = useApp();
	const { write } = useStdout();
	const [activeTab, setActiveTab] = useState<string | null>(null);
	const [menuIndex, setMenuIndex] = useState(0);
	const [tabCursors, setTabCursors] = useState(() => ({
		profilesName: null as string | null,
		instagram: 0,
		lists: 0,
	}));

	const clearScreen = () => {
		try {
			write('\x1b[2J\x1b[H');
		} catch {
			// ignore
		}
	};

	const handleSelect = (item: { value: string }) => {
		const idx = items.findIndex(i => i.value === item.value);
		if (idx >= 0) setMenuIndex(idx);
		if (item.value === 'exit') {
			exit();
			return;
		}
		clearScreen();
		setActiveTab(item.value);
	};

	if (activeTab === 'profiles') {
		return (
			<Profiles
				initialSelectedProfileName={tabCursors.profilesName}
				onSelectedProfileNameChange={name => setTabCursors(prev => ({ ...prev, profilesName: name }))}
				onBack={() => {
					clearScreen();
					setActiveTab(null);
				}}
			/>
		);
	}

	if (activeTab === 'instagram') {
		return (
			<Instagram
				initialMainFocusIndex={tabCursors.instagram}
				onMainFocusIndexChange={i => setTabCursors(prev => ({ ...prev, instagram: i }))}
				onBack={() => {
					clearScreen();
					setActiveTab(null);
				}}
			/>
		);
	}

	if (activeTab === 'lists') {
		return (
			<Lists
				initialSelectedIndex={tabCursors.lists}
				onSelectedIndexChange={i => setTabCursors(prev => ({ ...prev, lists: i }))}
				onBack={() => {
					clearScreen();
					setActiveTab(null);
				}}
			/>
		);
	}

	if (activeTab === 'logs') {
		return <Logs onBack={() => { clearScreen(); setActiveTab(null); }} />;
	}

	return (
		<Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
			<Box marginBottom={1}>
				<Text bold>Welcome to Anti Automation CLI, <Text color="green">{name}</Text>!</Text>
			</Box>
			<Box>
				<Text>Select an action:</Text>
			</Box>
			<SelectInput
				items={items}
				initialIndex={menuIndex}
				onHighlight={item => {
					const idx = items.findIndex(i => i.value === item.value);
					if (idx >= 0) setMenuIndex(idx);
				}}
				onSelect={handleSelect}
			/>
		</Box>
	);
}
