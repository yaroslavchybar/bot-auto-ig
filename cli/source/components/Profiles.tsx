import React, {useState, useEffect, useRef} from 'react';
import {Text, Box, useInput, useApp} from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import {profileManager, Profile} from '../lib/profiles.js';
import {getRandomUserAgent} from '../lib/user_agents.js';
import {spawn, ChildProcess} from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

export default function Profiles({onBack}: {onBack: () => void}) {
	const [profiles, setProfiles] = useState<Profile[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'delete' | 'logs'>('list');
	const [deleteConfirmation, setDeleteConfirmation] = useState<Profile | null>(null);
	const [formData, setFormData] = useState<Partial<Profile>>({});
	const [activeField, setActiveField] = useState(0);
	const [isEditingSelect, setIsEditingSelect] = useState(false);
	const [profileLogs, setProfileLogs] = useState<Map<string, string[]>>(new Map());
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [runningProfiles, setRunningProfiles] = useState<Set<string>>(new Set());
	const processesRef = useRef<Map<string, ChildProcess>>(new Map());

	const {exit} = useApp();

	useEffect(() => {
		loadProfiles();
	}, []);

	const loadProfiles = async () => {
		setLoading(true);
		const data = await profileManager.getProfiles();
		setProfiles(data);
		setLoading(false);
	};

	const toggleProfileState = (profileName: string, isRunning: boolean) => {
		setRunningProfiles(prev => {
			const next = new Set(prev);
			if (isRunning) {
				next.add(profileName);
			} else {
				next.delete(profileName);
			}
			return next;
		});
	};

	const getFields = () => {
		const isProxy = (formData as any).connection === 'proxy';
		return [
			{ key: 'name', label: 'Name', type: 'text' },
			{ key: 'type', label: 'Browser Type', type: 'select', options: [
				{label: 'Camoufox (Recommended)', value: 'Camoufox (рекомендуется)'},
				{label: 'Standard Firefox', value: 'Standard Firefox'}
			]},
			{ key: 'connection', label: 'Connection', type: 'select', options: [
				{label: 'Direct Connection', value: 'direct'},
				{label: 'Use Proxy', value: 'proxy'}
			]},
			...(isProxy ? [
				{ key: 'proxy_type', label: 'Proxy Type', type: 'select', options: [
					{label: 'HTTP', value: 'http'},
					{label: 'HTTPS', value: 'https'},
					{label: 'SOCKS4', value: 'socks4'},
					{label: 'SOCKS5', value: 'socks5'},
					{label: 'SSH', value: 'ssh'}
				]},
				{ key: 'proxy', label: 'Proxy (ip:port:user:pass)', type: 'text' }
			] : []),
			{ key: 'ua_os', label: 'UA OS', type: 'select', options: [
				{label: 'Any', value: 'Любая'},
				{label: 'Windows', value: 'Windows'},
				{label: 'macOS', value: 'macOS'},
				{label: 'Linux', value: 'Linux'}
			]},
			{ key: 'ua_browser', label: 'UA Browser', type: 'select', options: [
				{label: 'Firefox (Recommended)', value: 'Firefox'},
				{label: 'Chrome', value: 'Chrome'},
				{label: 'Safari', value: 'Safari'}
			]},
			{ key: 'user_agent', label: 'User Agent', type: 'text' },
			{ key: 'regen_ua', label: 'Regenerate User Agent', type: 'button' },
			{ key: 'test_ip', label: 'Test IP', type: 'toggle' },
			{ key: 'save', label: 'Save Profile', type: 'button' },
			{ key: 'cancel', label: 'Cancel', type: 'button' }
		];
	};

	useInput((input, key) => {
		if (loading) return;

		if (mode === 'list') {
			if (key.escape) {
				onBack();
				return;
			}

			if (key.upArrow) {
				setSelectedIndex(Math.max(0, selectedIndex - 1));
			}
			if (key.downArrow) {
				setSelectedIndex(Math.min(profiles.length - 1, selectedIndex + 1));
			}
			if (input === 'c') {
				setMode('create');
				setFormData({
					name: '',
					type: 'Camoufox (рекомендуется)',
					proxy: '',
					// @ts-ignore
					connection: 'direct',
					// @ts-ignore
					proxy_type: 'http',
					ua_os: 'Windows',
					ua_browser: 'Firefox',
					user_agent: getRandomUserAgent('Windows', 'Firefox'),
					test_ip: false
				});
				setActiveField(0);
				setIsEditingSelect(false);
			}
			if (input === 'r') {
				loadProfiles();
			}
			if (profiles.length > 0) {
				const currentProfile = profiles[selectedIndex];
				if (input === 'e') {
					setMode('edit');
					
					let pType = 'http';
					let pVal = currentProfile.proxy || '';
					if (pVal.includes('://')) {
						const parts = pVal.split('://');
						pType = parts[0];
						pVal = parts[1];
					}

					setFormData({
						...currentProfile,
						proxy: pVal,
						ua_os: currentProfile.ua_os || 'Windows',
						ua_browser: currentProfile.ua_browser || 'Firefox',
						// @ts-ignore
						connection: currentProfile.proxy ? 'proxy' : 'direct',
						// @ts-ignore
						proxy_type: (currentProfile as any).proxy_type || pType
					});
					setActiveField(0);
					setIsEditingSelect(false);
				}
				if (input === 'd') {
					// Delete confirmation
					if (currentProfile.name) {
						setDeleteConfirmation(currentProfile);
						setMode('delete');
					}
				}
				if (input === 's') {
					// Toggle Start/Stop
					toggleProfile(currentProfile);
				}
				if (input === 'l') {
					setMode('logs');
				}
			}
		} else if (mode === 'create' || mode === 'edit') {
			const fields = getFields();
			const field = fields[activeField];

			if (isEditingSelect) {
				if (key.escape) setIsEditingSelect(false);
				return;
			}

			if (key.escape) {
				setMode('list');
				setError(null);
				return;
			}

			if (key.upArrow) {
				setActiveField(Math.max(0, activeField - 1));
			}
			if (key.downArrow) {
				setActiveField(Math.min(fields.length - 1, activeField + 1));
			}

			if (key.return) {
				if (field.type === 'select') {
					setIsEditingSelect(true);
				} else if (field.type === 'toggle') {
					setFormData(prev => ({...prev, test_ip: !prev.test_ip}));
				} else if (field.key === 'regen_ua') {
					const ua = getRandomUserAgent(formData.ua_os, formData.ua_browser);
					setFormData(prev => ({...prev, user_agent: ua}));
				} else if (field.key === 'save') {
					saveProfile();
				} else if (field.key === 'cancel') {
					setMode('list');
					setError(null);
				}
			}
			
			if (field.type === 'toggle' && input === ' ') {
				setFormData(prev => ({...prev, test_ip: !prev.test_ip}));
			}

			if (field.key === 'user_agent' && input === 'g' && key.ctrl) {
				const ua = getRandomUserAgent(formData.ua_os, formData.ua_browser);
				setFormData(prev => ({...prev, user_agent: ua}));
			}
		} else if (mode === 'delete') {
			if (key.escape || input === 'n') {
				setMode('list');
				setDeleteConfirmation(null);
			}
			if (key.return || input === 'y') {
				if (deleteConfirmation && deleteConfirmation.name) {
					setLoading(true);
					profileManager.deleteProfile(deleteConfirmation.name).then(() => {
						loadProfiles();
						setMode('list');
						setDeleteConfirmation(null);
					});
				}
			}
		} else if (mode === 'logs') {
			if (key.escape) {
				setMode('list');
			}
		}
	});

	const addLog = (name: string, message: string) => {
		setProfileLogs(prev => {
			const next = new Map(prev);
			const currentLogs = next.get(name) || [];
			// Clean up message
			const lines = message.split('\n').filter(l => l.trim().length > 0);
			// Keep up to 1000 lines for detailed view
			const newLogs = [...currentLogs, ...lines].slice(-1000); 
			next.set(name, newLogs);
			return next;
		});
	};

	const toggleProfile = (profile: Profile) => {
		const name = profile.name;
		if (processesRef.current.has(name)) {
			// Stop
			const proc = processesRef.current.get(name);
			if (proc) {
				proc.kill();
			}
			void profileManager.syncProfileStatus(name, 'idle', false);
		} else {
			// Start
			const scriptPath = path.join(PROJECT_ROOT, 'launcher.py');
			const args = ['--name', name];
			if (profile.proxy) args.push('--proxy', profile.proxy);
			args.push('--action', 'manual');
			if (profile.user_agent) args.push('--user-agent', profile.user_agent);

			try {
				const child = spawn('python', [scriptPath, ...args], {
					cwd: PROJECT_ROOT, // Fix: Run from root so it finds profiles/
					stdio: ['ignore', 'pipe', 'pipe'],
					detached: false
				});

				if (child.stdout) {
					child.stdout.on('data', (data) => addLog(name, data.toString()));
				}
				if (child.stderr) {
					child.stderr.on('data', (data) => addLog(name, data.toString()));
				}

				processesRef.current.set(name, child);
				toggleProfileState(name, true);
				void profileManager.syncProfileStatus(name, 'running', true);

				child.on('exit', () => {
					processesRef.current.delete(name);
					toggleProfileState(name, false);
					void profileManager.syncProfileStatus(name, 'idle', false);
				});
				
				child.on('error', (err) => {
					setError(`Failed to start ${name}: ${err.message}`);
					processesRef.current.delete(name);
					toggleProfileState(name, false);
					void profileManager.syncProfileStatus(name, 'idle', false);
				});
			} catch (e: any) {
				setError(`Failed to spawn: ${e.message}`);
			}
		}
	};

	const saveProfile = async () => {
		setLoading(true);
		setError(null);
		
		try {
			if (!formData.name) throw new Error("Name is required");

			const finalData = { ...formData };
			if ((finalData as any).connection === 'proxy' && finalData.proxy) {
				const pType = (finalData as any).proxy_type || 'http';
				let pVal = finalData.proxy;
				// If user pasted a full URL, strip the scheme first
				if (pVal.includes('://')) {
					pVal = pVal.split('://')[1];
				}
				finalData.proxy = `${pType}://${pVal}`;
			} else if ((finalData as any).connection === 'direct') {
				finalData.proxy = '';
				(finalData as any).proxy_type = null;
			}
			
			// Cleanup temp fields if necessary, though Profile type ignores extra fields mostly
			// But let's be clean
			delete (finalData as any).proxy_type;
			delete (finalData as any).connection;

			if (mode === 'create') {
				await profileManager.createProfile(finalData as Profile);
			} else {
				// We need original name for update if name changed.
				// But we didn't store original name separately.
				// Assuming name doesn't change for now or we find by ID?
				// profiles_tab.py allows name change.
				// Let's just pass formData.name and hope we didn't change it, 
				// OR we need to know the ID.
				// If we are in edit mode, profiles[selectedIndex] is the old profile.
				await profileManager.updateProfile(profiles[selectedIndex].name, finalData as Profile);
			}
			await loadProfiles();
			setMode('list');
		} catch (e: any) {
			setError(e.message);
		} finally {
			setLoading(false);
		}
	};

	if (mode === 'list') {
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={1}>
					<Text bold>Profiles ({profiles.length})</Text>
					<Text color="gray"> | </Text>
					<Text>[C]reate | [R]efresh | [T]OTP | [Esc] Back</Text>
				</Box>

				{loading && <Text>Loading...</Text>}
				{error && <Text color="red">{error}</Text>}

				<Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1} minHeight={10}>
					{profiles.length === 0 && !loading ? (
						<Text>No profiles found.</Text>
					) : (
						profiles.map((profile, index) => {
							const isSelected = index === selectedIndex;
							return (
								<Box key={profile.name || index}>
									<Text color={isSelected ? 'green' : 'white'}>
										{isSelected ? '> ' : '  '}
										{profile.name} 
									</Text>
									<Box marginLeft={2}>
										<Text color="gray">
											{profile.proxy ? '🌐 Proxy' : '🏠 Direct'}
										</Text>
									</Box>
									{runningProfiles.has(profile.name) && (
										<Box marginLeft={2}>
											<Text color="yellow">⚡ Running</Text>
										</Box>
									)}
									{isSelected && (
										<Box marginLeft={2}>
											<Text color="cyan">
												{runningProfiles.has(profile.name) ? '[S]top ' : '[S]tart '}
												[E]dit [D]elete
											</Text>
										</Box>
									)}
								</Box>
							);
						})
					)}
				</Box>

				<Box marginTop={1} borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1} minHeight={6}>
					<Text bold>� Logs: {profiles[selectedIndex]?.name || 'N/A'}</Text>
					<Box flexDirection="column">
						{(profileLogs.get(profiles[selectedIndex]?.name) || []).length === 0 ? (
							<Text color="gray">No logs available...</Text>
						) : (
							(profileLogs.get(profiles[selectedIndex]?.name) || []).slice(-15).map((log, i) => (
								<Text key={i} color="gray">{log}</Text>
							))
						)}
					</Box>
				</Box>
			</Box>
		);
	}

	if (mode === 'create' || mode === 'edit') {
		const fields = getFields();

		return (
			<Box flexDirection="column" padding={1}>
				<Text bold>{mode === 'create' ? 'Create New Profile' : 'Edit Profile'}</Text>
				{error && <Text color="red">{error}</Text>}
				
				<Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" padding={1}>
					{fields.map((field, index) => {
						const isActive = index === activeField;
						const labelColor = isActive ? 'green' : 'white';
						const prefix = isActive ? '> ' : '  ';

						if (field.type === 'button') {
							return (
								<Box key={field.key} marginTop={1}>
									<Text color={isActive ? 'black' : 'white'} backgroundColor={isActive ? 'green' : undefined}>
										{' ' + field.label + ' '}
									</Text>
								</Box>
							);
						}

						let content;
						if (field.type === 'text') {
							if (isActive) {
								content = (
									<TextInput 
										value={(formData as any)[field.key] || ''} 
										onChange={(val) => setFormData({...formData, [field.key]: val})}
									/>
								);
							} else {
								content = <Text color="gray">{(formData as any)[field.key] || ''}</Text>;
							}
						} else if (field.type === 'select') {
							const currentValue = (formData as any)[field.key];
							const currentOption = (field.options as any[]).find(o => o.value === currentValue);
							const displayValue = currentOption ? currentOption.label : currentValue;

							if (isActive && isEditingSelect) {
								content = (
									<Box borderStyle="round" borderColor="blue">
										<SelectInput
											items={field.options as any}
											onSelect={(item) => {
												const updates: any = { [field.key]: item.value };
												
												if (field.key === 'connection') {
													if (item.value === 'direct') {
														updates.proxy = '';
													}
												}
												if (field.key === 'ua_browser') {
													const newUa = getRandomUserAgent(formData.ua_os, item.value as string);
													updates.user_agent = newUa;
												}
												
												setFormData(prev => ({...prev, ...updates}));
												setIsEditingSelect(false);
											}}
										/>
									</Box>
								);
							} else {
								content = <Text color={isActive ? 'cyan' : 'gray'}>{displayValue}</Text>;
							}
						} else if (field.type === 'toggle') {
							const val = (formData as any)[field.key];
							content = <Text color={val ? 'cyan' : 'gray'}>{val ? 'Yes' : 'No'}</Text>;
						}

						return (
							<Box key={field.key} flexDirection="column" marginBottom={1}>
								<Box>
									<Text color={labelColor}>{prefix}{field.label}: </Text>
									{content}
								</Box>
								{isActive && (field as any).help && (
									<Text color="gray" dimColor>  {(field as any).help}</Text>
								)}
							</Box>
						);
					})}
				</Box>

				<Box marginTop={1}>
					<Text color="gray">↑/↓: Navigate | Enter: Edit/Toggle | Esc: Cancel</Text>
				</Box>
			</Box>
		);
	}

	if (mode === 'delete') {
		return (
			<Box flexDirection="column" padding={1} borderColor="red" borderStyle="single">
				<Text bold color="red">Delete Profile</Text>
				<Box marginTop={1}>
					<Text>Are you sure you want to delete profile </Text>
					<Text bold color="yellow">{deleteConfirmation?.name}</Text>
					<Text>?</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="gray">[Y]es / [N]o / [Esc] Cancel</Text>
				</Box>
			</Box>
		);
	}

	if (mode === 'logs') {
		const currentLogs = profileLogs.get(profiles[selectedIndex]?.name) || [];
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={1}>
					<Text bold>📝 Full Logs: {profiles[selectedIndex]?.name}</Text>
					<Text color="gray"> | </Text>
					<Text>[Esc] Back</Text>
				</Box>
				<Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1} minHeight={20}>
					{currentLogs.length === 0 ? (
						<Text color="gray">No logs available.</Text>
					) : (
						currentLogs.map((log, i) => (
							<Text key={i}>{log}</Text>
						))
					)}
				</Box>
			</Box>
		);
	}

	return <Text>Unknown state</Text>;
}
