import React, {useState} from 'react';
import {Text, Box, useApp, useStdout} from 'ink';
import SelectInput from 'ink-select-input';
import Profiles from './components/Profiles.js';
import Instagram from './components/Instagram.js';
import Lists from './components/Lists.js';
import Logs from './components/Logs.js';
import Login from './components/Login.js';

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
		label: 'Login Automation',
		value: 'login',
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
	const [menuIndex, setMenuIndex] = useState(0);
	const [tabCursors, setTabCursors] = useState(() => ({
		profiles: 0,
		instagram: 0,
		lists: 0,
		login: 0,
	}));

	const clearScreen = () => {
		try {
			write('\x1b[2J\x1b[H');
		} catch {
			// ignore
		}
	};

	const handleSelect = (item: {value: string}) => {
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
				initialSelectedIndex={tabCursors.profiles}
				onSelectedIndexChange={i => setTabCursors(prev => ({...prev, profiles: i}))}
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
				onMainFocusIndexChange={i => setTabCursors(prev => ({...prev, instagram: i}))}
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
				onSelectedIndexChange={i => setTabCursors(prev => ({...prev, lists: i}))}
				onBack={() => {
					clearScreen();
					setActiveTab(null);
				}}
			/>
		);
	}

	if (activeTab === 'login') {
		return (
			<Login
				initialProfilePickerIndex={tabCursors.login}
				onProfilePickerIndexChange={i => setTabCursors(prev => ({...prev, login: i}))}
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
