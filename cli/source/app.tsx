import React, {useState} from 'react';
import {Text, Box, useApp, useStdout} from 'ink';
import SelectInput from 'ink-select-input';
import Profiles from './components/Profiles.js';
import Instagram from './components/Instagram.js';
import Lists from './components/Lists.js';
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

export default function App({name = 'User'}: Props) {
	const {exit} = useApp();
	const {write} = useStdout();
	const [activeTab, setActiveTab] = useState<string | null>(null);

	const clearScreen = () => {
		try {
			write('\x1b[2J\x1b[H');
		} catch {
			// ignore
		}
	};

	const handleSelect = (item: {value: string}) => {
		if (item.value === 'exit') {
			exit();
			return;
		}
		clearScreen();
		setActiveTab(item.value);
	};

	if (activeTab === 'profiles') {
		return <Profiles onBack={() => { clearScreen(); setActiveTab(null); }} />;
	}

	if (activeTab === 'instagram') {
		return <Instagram onBack={() => { clearScreen(); setActiveTab(null); }} />;
	}

	if (activeTab === 'lists') {
		return <Lists onBack={() => { clearScreen(); setActiveTab(null); }} />;
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
			<SelectInput items={items} onSelect={handleSelect} />
		</Box>
	);
}
