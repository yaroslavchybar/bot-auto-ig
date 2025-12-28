import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Text, Box, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {spawn, type ChildProcessWithoutNullStreams} from 'child_process';
import path from 'path';
import {fileURLToPath} from 'url';
import {callBridge} from '../lib/supabase.js';
import {appendLog, getLogs, subscribeLogs} from '../lib/logStore.js';

let currentProc: ChildProcessWithoutNullStreams | null = null;
let listenersAttached = false;

type Props = {
	onBack: () => void;
	initialMainFocusIndex: number;
	onMainFocusIndexChange: (index: number) => void;
};

type View =
	| 'main'
	| 'lists'
	| 'order'
	| 'orderAdd'
	| 'cooldown'
	| 'feed'
	| 'reels'
	| 'stories'
	| 'follow'
	| 'unfollow'
	| 'message';

type ActionName =
	| 'Feed Scroll'
	| 'Reels Scroll'
	| 'Watch Stories'
	| 'Follow'
	| 'Unfollow'
	| 'Approve Requests'
	| 'Send Messages';

type ListRow = {id: string; name: string};

type LogEntry = {ts: number; message: string; source?: string};

type InstagramSettings = {
	automation_enabled: boolean;
	use_private_profiles: boolean;
	action_order: ActionName[];
	like_chance: number;
	carousel_watch_chance: number;
	follow_chance: number;
	reels_like_chance: number;
	reels_follow_chance: number;
	reels_skip_chance: number;
	reels_skip_min_time: number;
	reels_skip_max_time: number;
	reels_normal_min_time: number;
	reels_normal_max_time: number;
	carousel_max_slides: number;
	stories_max: number;
	feed_min_time_minutes: number;
	feed_max_time_minutes: number;
	reels_min_time_minutes: number;
	reels_max_time_minutes: number;
	max_sessions: number;
	parallel_profiles: number;
	enable_feed: boolean;
	enable_reels: boolean;
	enable_follow: boolean;
	watch_stories: boolean;
	headless: boolean;
	profile_reopen_cooldown_enabled: boolean;
	profile_reopen_cooldown_minutes: number;
	messaging_cooldown_enabled: boolean;
	messaging_cooldown_hours: number;
	highlights_min: number;
	highlights_max: number;
	likes_percentage: number;
	scroll_percentage: number;
	following_limit: number;
	follow_min_count: number;
	follow_max_count: number;
	min_delay: number;
	max_delay: number;
	unfollow_min_count: number;
	unfollow_max_count: number;
	do_unfollow: boolean;
	do_approve: boolean;
	do_message: boolean;
	source_list_ids: string[];
};

const ACTIONS: ActionName[] = [
	'Feed Scroll',
	'Reels Scroll',
	'Watch Stories',
	'Follow',
	'Unfollow',
	'Approve Requests',
	'Send Messages',
];

const DEFAULT_SETTINGS: InstagramSettings = {
	automation_enabled: false,
	use_private_profiles: true,
	action_order: [...ACTIONS],
	like_chance: 10,
	carousel_watch_chance: 0,
	follow_chance: 50,
	reels_like_chance: 10,
	reels_follow_chance: 50,
	reels_skip_chance: 30,
	reels_skip_min_time: 0.8,
	reels_skip_max_time: 2.0,
	reels_normal_min_time: 5.0,
	reels_normal_max_time: 20.0,
	carousel_max_slides: 3,
	stories_max: 3,
	feed_min_time_minutes: 1,
	feed_max_time_minutes: 3,
	reels_min_time_minutes: 1,
	reels_max_time_minutes: 3,
	max_sessions: 5,
	parallel_profiles: 1,
	enable_feed: true,
	enable_reels: false,
	enable_follow: false,
	watch_stories: true,
	headless: false,
	profile_reopen_cooldown_enabled: true,
	profile_reopen_cooldown_minutes: 30,
	messaging_cooldown_enabled: true,
	messaging_cooldown_hours: 2,
	highlights_min: 2,
	highlights_max: 4,
	likes_percentage: 0,
	scroll_percentage: 0,
	following_limit: 3000,
	follow_min_count: 5,
	follow_max_count: 15,
	min_delay: 10,
	max_delay: 30,
	unfollow_min_count: 5,
	unfollow_max_count: 15,
	do_unfollow: false,
	do_approve: false,
	do_message: false,
	source_list_ids: [],
};

const PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN = [5, 10, 15, 30, 45, 60, 90, 120];
const MESSAGING_COOLDOWN_OPTIONS_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'cli', 'scripts', 'instagram_automation.py');

function clamp(n: number, min: number, max: number) {
	return Math.max(min, Math.min(max, n));
}

function toInt(value: string, fallback: number) {
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value: string, fallback: number) {
	const parsed = Number.parseFloat(value.trim());
	return Number.isFinite(parsed) ? parsed : fallback;
}

function nextPercent(value: number, delta: number) {
	const step = 10;
	const v = clamp(Math.round(value / step) * step + delta * step, 0, 100);
	return v;
}

export default function Instagram({onBack, initialMainFocusIndex, onMainFocusIndexChange}: Props) {
	const [view, setView] = useState<View>('main');
	const [settings, setSettings] = useState<InstagramSettings>(DEFAULT_SETTINGS);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [focusIndex, setFocusIndex] = useState(initialMainFocusIndex);
	const [mainFocusIndex, setMainFocusIndex] = useState(initialMainFocusIndex);
	const onMainFocusIndexChangeRef = useRef(onMainFocusIndexChange);
	const [lists, setLists] = useState<ListRow[]>([]);
	const [listsIndex, setListsIndex] = useState(0);
	const [orderIndex, setOrderIndex] = useState(0);
	const [orderAddIndex, setOrderAddIndex] = useState(0);
	const [cooldownKind, setCooldownKind] = useState<'profile_reopen' | 'messaging'>('profile_reopen');
	const [cooldownIndex, setCooldownIndex] = useState(0);

	const [messageKind, setMessageKind] = useState<'message' | 'message_2'>('message');
	const [messageLines, setMessageLines] = useState<string[]>([]);
	const [messageIndex, setMessageIndex] = useState(0);
	const [messageMode, setMessageMode] = useState<'list' | 'create' | 'edit' | 'delete'>('list');
	const [messageDraft, setMessageDraft] = useState('');

	const procRef = useRef<ChildProcessWithoutNullStreams | null>(null);
	const [running, setRunning] = useState(false);
	const [logTick, setLogTick] = useState(0);

	const enabledMap = useMemo(() => {
		return {
			'Feed Scroll': settings.enable_feed,
			'Reels Scroll': settings.enable_reels,
			'Watch Stories': settings.watch_stories,
			Follow: settings.enable_follow,
			Unfollow: settings.do_unfollow,
			'Approve Requests': settings.do_approve,
			'Send Messages': settings.do_message,
		} as const;
	}, [settings]);

	const visibleOrder = useMemo(() => {
		return settings.action_order.filter(a => enabledMap[a]);
	}, [settings.action_order, enabledMap]);

	const lastLogs = useMemo(() => {
		const all = getLogs() as unknown as LogEntry[];
		const lines = all.slice(-1).map((l: LogEntry) => l.message);
		return lines;
	}, [logTick]);

	const persist = async (next: InstagramSettings) => {
		setSaving(true);
		setError(null);
		try {
			await callBridge('instagram_settings.upsert', {scope: 'global', data: next});
		} catch (e: any) {
			setError(e?.message || String(e));
		} finally {
			setSaving(false);
		}
	};

	const loadSettings = async () => {
		setLoading(true);
		setError(null);
		try {
			const cloud = await callBridge<any | null>('instagram_settings.get', {scope: 'global'});
			const merged: InstagramSettings = {
				...DEFAULT_SETTINGS,
				...(typeof cloud === 'object' && cloud ? cloud : {}),
			};
			merged.action_order = Array.isArray(merged.action_order) && merged.action_order.length > 0 ? merged.action_order : [...ACTIONS];
			merged.source_list_ids = Array.isArray(merged.source_list_ids) ? merged.source_list_ids : [];
			setSettings(merged);
			if (merged.automation_enabled && !currentProc) startAutomation(merged);
		} catch (e: any) {
			setSettings(DEFAULT_SETTINGS);
			setError(e?.message || String(e));
		} finally {
			setLoading(false);
		}
	};

	const fetchLists = async () => {
		setError(null);
		try {
			const data = await callBridge<any[]>('lists.list');
			setLists((data as any) || []);
			setListsIndex(0);
		} catch (e: any) {
			setError(e?.message || String(e));
			setLists([]);
		}
	};

	const fetchMessageTemplates = async (kind: 'message' | 'message_2') => {
		setError(null);
		try {
			const texts = await callBridge<string[]>('message_templates.get', {kind});
			setMessageLines(Array.isArray(texts) ? texts.filter((t: any) => String(t).trim()).map((t: any) => String(t)) : []);
			setMessageIndex(0);
		} catch (e: any) {
			setError(e?.message || String(e));
			setMessageLines([]);
		}
	};

	const saveMessageTemplates = async (kind: 'message' | 'message_2', lines: string[]) => {
		setSaving(true);
		setError(null);
		try {
			await callBridge('message_templates.upsert', {kind, texts: lines});
			appendLog(`Saved ${lines.length} message templates (${kind})`, 'instagram');
		} catch (e: any) {
			setError(e?.message || String(e));
		} finally {
			setSaving(false);
		}
	};

	const clearBusyProfiles = async () => {
		const listIds = Array.isArray(settings.source_list_ids) ? settings.source_list_ids : [];
		if (listIds.length === 0) return;
		try {
			await callBridge('profiles.clear_busy_for_lists', {list_ids: listIds});
		} catch {
		}
	};

	const stopAutomation = () => {
		setSettings(prev => {
			if (!prev.automation_enabled) return prev;
			const next = {...prev, automation_enabled: false};
			void persist(next);
			return next;
		});

		const proc = currentProc || procRef.current;
		if (!proc) return;
		appendLog('Stopping automation...', 'instagram');
		try {
			proc.kill();
		} catch {
		}
		void clearBusyProfiles();
		currentProc = null;
		procRef.current = null;
		listenersAttached = false;
		setRunning(false);
	};

	const startAutomation = (override?: InstagramSettings) => {
		if (currentProc) return;
		const runSettings = override || settings;
		const hasAny =
			runSettings.enable_feed ||
			runSettings.enable_reels ||
			runSettings.watch_stories ||
			runSettings.enable_follow ||
			runSettings.do_unfollow ||
			runSettings.do_approve ||
			runSettings.do_message;
		if (!hasAny) {
			setError('Select at least one activity');
			return;
		}
		if (runSettings.source_list_ids.length === 0) {
			setError('Select at least one list');
			return;
		}

		setError(null);
		appendLog('Starting Instagram automation...', 'instagram');

		const nextSettings = runSettings.automation_enabled ? runSettings : {...runSettings, automation_enabled: true};
		if (!runSettings.automation_enabled) {
			setSettings(nextSettings);
			void persist(nextSettings);
		}

		const python = process.env.PYTHON || 'python';
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn(python, [PYTHON_RUNNER], {cwd: PROJECT_ROOT, stdio: 'pipe'});
		} catch (e: any) {
			const msg = e?.message || String(e);
			setError(msg);
			appendLog(`Automation failed: ${msg}`, 'instagram');
			setRunning(false);
			return;
		}
		currentProc = child;
		procRef.current = child;
		setRunning(true);

		const onChunk = (chunk: any, stream: 'stdout' | 'stderr') => {
			const text = chunk.toString('utf8');
			const parts = text.split(/\r?\n/).filter(Boolean);
			for (const line of parts) appendLog(line, stream === 'stderr' ? 'ig:err' : 'ig');
		};

		if (!listenersAttached) {
			child.stdout.on('data', c => onChunk(c, 'stdout'));
			child.stderr.on('data', c => onChunk(c, 'stderr'));
			child.on('exit', code => {
				currentProc = null;
				procRef.current = null;
				setRunning(false);
				appendLog(`Automation exited (code ${code ?? 'null'})`, 'instagram');
				void clearBusyProfiles();
				listenersAttached = false;
			});
			child.on('error', err => {
				currentProc = null;
				procRef.current = null;
				setRunning(false);
				setError(err.message);
				appendLog(`Automation failed: ${err.message}`, 'instagram');
				void clearBusyProfiles();
				listenersAttached = false;
			});
			listenersAttached = true;
		}

		const payload = JSON.stringify({settings: nextSettings});
		child.stdin.write(payload);
		child.stdin.end();
	};

	useEffect(() => {
		loadSettings();
	}, []);

	useEffect(() => {
		setRunning(!!currentProc);
	}, []);

	useEffect(() => {
		return subscribeLogs(() => setLogTick(v => v + 1));
	}, []);

	useEffect(() => {
		const id = setInterval(() => {
			setRunning(!!currentProc);
		}, 500);
		return () => clearInterval(id);
	}, []);

	const mainFocusables = useMemo(
		() => [
			'max_sessions',
			'parallel_profiles',
			'headless',
			'profile_reopen_cooldown_enabled',
			'messaging_cooldown_enabled',
			'source_lists',
			'enable_feed',
			'enable_reels',
			'watch_stories',
			'enable_follow',
			'do_unfollow',
			'do_approve',
			'do_message',
			'action_order',
			'start_stop',
			'back',
		],
		[]
	);

	const currentField = mainFocusables[focusIndex] || 'max_sessions';

	useEffect(() => {
		const max = Math.max(0, mainFocusables.length - 1);
		setFocusIndex(i => clamp(i, 0, max));
		setMainFocusIndex(i => clamp(i, 0, max));
	}, [mainFocusables.length]);

	useEffect(() => {
		onMainFocusIndexChangeRef.current = onMainFocusIndexChange;
	}, [onMainFocusIndexChange]);

	useEffect(() => {
		onMainFocusIndexChangeRef.current(mainFocusIndex);
	}, [mainFocusIndex]);

	useInput((input, key) => {
		if (loading) return;

		const openCooldownMenu = (kind: 'profile_reopen' | 'messaging') => {
			setMainFocusIndex(focusIndex);
			setCooldownKind(kind);
			const opts = kind === 'profile_reopen' ? PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN : MESSAGING_COOLDOWN_OPTIONS_HOURS;
			const current = kind === 'profile_reopen' ? settings.profile_reopen_cooldown_minutes : settings.messaging_cooldown_hours;
			const idx = opts.findIndex(v => v === current);
			setCooldownIndex(idx >= 0 ? idx : 0);
			setView('cooldown');
		};

		if (view === 'lists') {
			if (key.escape) {
				setView('main');
				setFocusIndex(mainFocusIndex);
				return;
			}
			if (key.upArrow) {
				setListsIndex(i => clamp(i - 1, 0, Math.max(0, lists.length - 1)));
			}
			if (key.downArrow) {
				setListsIndex(i => clamp(i + 1, 0, Math.max(0, lists.length - 1)));
			}
			if (input === 'r' || input === 'R') {
				void fetchLists();
			}
			if (input === ' ' || key.return) {
				const row = lists[listsIndex];
				if (!row) return;
				setSettings(prev => {
					const set = new Set(prev.source_list_ids);
					if (set.has(row.id)) set.delete(row.id);
					else set.add(row.id);
					const next = {...prev, source_list_ids: [...set]};
					void persist(next);
					return next;
				});
			}
			return;
		}

		if (view === 'cooldown') {
			const opts = cooldownKind === 'profile_reopen' ? PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN : MESSAGING_COOLDOWN_OPTIONS_HOURS;
			if (key.escape) {
				setView('main');
				setFocusIndex(mainFocusIndex);
				return;
			}
			if (key.upArrow) setCooldownIndex(i => clamp(i - 1, 0, Math.max(0, opts.length - 1)));
			if (key.downArrow) setCooldownIndex(i => clamp(i + 1, 0, Math.max(0, opts.length - 1)));
			if (key.return || input === ' ') {
				const selected = opts[cooldownIndex];
				if (selected !== undefined) {
					setSettings(prev => {
						const next =
							cooldownKind === 'profile_reopen'
								? ({...prev, profile_reopen_cooldown_minutes: selected} as InstagramSettings)
								: ({...prev, messaging_cooldown_hours: selected} as InstagramSettings);
						void persist(next);
						return next;
					});
				}
				setView('main');
				setFocusIndex(mainFocusIndex);
				return;
			}
			return;
		}

		if (view === 'order') {
			if (key.escape) {
				setView('main');
				setFocusIndex(mainFocusIndex);
				return;
			}
			if (key.upArrow) setOrderIndex(i => clamp(i - 1, 0, Math.max(0, visibleOrder.length - 1)));
			if (key.downArrow) setOrderIndex(i => clamp(i + 1, 0, Math.max(0, visibleOrder.length - 1)));

			const move = (dir: number) => {
				const action = visibleOrder[orderIndex];
				if (!action) return;
				const enabled = enabledMap;
				const visible = settings.action_order.filter(a => enabled[a]);
				const idx = visible.indexOf(action);
				const newIdx = clamp(idx + dir, 0, Math.max(0, visible.length - 1));
				if (idx === -1 || newIdx === idx) return;
				const swapped = [...visible];
				const tmp = swapped[idx];
				swapped[idx] = swapped[newIdx];
				swapped[newIdx] = tmp;
				const nextOrder: ActionName[] = [];
				let vi = 0;
				for (const a of settings.action_order) {
					if (enabled[a]) {
						nextOrder.push(swapped[vi] as ActionName);
						vi += 1;
					} else {
						nextOrder.push(a);
					}
				}
				const next = {...settings, action_order: nextOrder};
				setSettings(next);
				void persist(next);
				setOrderIndex(clamp(orderIndex + dir, 0, Math.max(0, visibleOrder.length - 1)));
			};

			if (key.ctrl && key.upArrow) move(-1);
			if (key.ctrl && key.downArrow) move(1);
			if (key.ctrl && key.pageUp) move(-1);
			if (key.ctrl && key.pageDown) move(1);
			if (key.leftArrow) move(-1);
			if (key.rightArrow) move(1);

			if (input === 'd' || input === 'D' || key.delete || key.backspace) {
				const action = visibleOrder[orderIndex];
				if (!action) return;
				const idx = settings.action_order.indexOf(action);
				if (idx < 0) return;
				const nextOrder = [...settings.action_order];
				nextOrder.splice(idx, 1);
				const next = {...settings, action_order: nextOrder};
				setSettings(next);
				void persist(next);
				setOrderIndex(i => clamp(i, 0, Math.max(0, visibleOrder.length - 2)));
			}
			if (input === 'a' || input === 'A') {
				setOrderAddIndex(0);
				setView('orderAdd');
			}
			return;
		}

		if (view === 'orderAdd') {
			if (key.escape) {
				setView('order');
				return;
			}
			const candidates = ACTIONS.filter(a => enabledMap[a]);
			if (key.upArrow) setOrderAddIndex(i => clamp(i - 1, 0, Math.max(0, candidates.length - 1)));
			if (key.downArrow) setOrderAddIndex(i => clamp(i + 1, 0, Math.max(0, candidates.length - 1)));
			if (key.return) {
				const action = candidates[orderAddIndex];
				if (!action) return;
				const next = {...settings, action_order: [...settings.action_order, action]};
				setSettings(next);
				void persist(next);
				setView('order');
			}
			return;
		}

		if (view === 'feed' || view === 'reels' || view === 'stories' || view === 'follow' || view === 'unfollow') {
			if (key.escape) {
				setView('main');
				setFocusIndex(mainFocusIndex);
				return;
			}
			const fieldsByView: Record<string, string[]> = {
				feed: ['feed_min_time_minutes', 'feed_max_time_minutes', 'like_chance', 'follow_chance', 'carousel_watch_chance', 'carousel_max_slides'],
				reels: [
					'reels_min_time_minutes',
					'reels_max_time_minutes',
					'reels_like_chance',
					'reels_follow_chance',
					'reels_skip_chance',
					'reels_skip_min_time',
					'reels_skip_max_time',
					'reels_normal_min_time',
					'reels_normal_max_time',
				],
				stories: ['stories_max'],
				follow: [
					'highlights_min',
					'highlights_max',
					'likes_percentage',
					'scroll_percentage',
					'following_limit',
					'follow_min_count',
					'follow_max_count',
				],
				unfollow: ['min_delay', 'max_delay', 'unfollow_min_count', 'unfollow_max_count'],
			};
			const fields = fieldsByView[view];
			if (!fields) return;

			if (key.upArrow) setFocusIndex(i => clamp(i - 1, 0, Math.max(0, fields.length - 1)));
			if (key.downArrow) setFocusIndex(i => clamp(i + 1, 0, Math.max(0, fields.length - 1)));

			const field = fields[focusIndex];
			const percentFields = new Set(['like_chance', 'follow_chance', 'carousel_watch_chance', 'reels_like_chance', 'reels_follow_chance', 'reels_skip_chance']);
			if (percentFields.has(field)) {
				if (key.leftArrow) {
					setSettings(prev => {
						const next = {...prev, [field]: nextPercent((prev as any)[field], -1)} as InstagramSettings;
						void persist(next);
						return next;
					});
				}
				if (key.rightArrow) {
					setSettings(prev => {
						const next = {...prev, [field]: nextPercent((prev as any)[field], 1)} as InstagramSettings;
						void persist(next);
						return next;
					});
				}
			}
			return;
		}

		if (view === 'message') {
			if (messageMode === 'list') {
				if (key.escape) {
					setView('main');
					setFocusIndex(mainFocusIndex);
					return;
				}
				if (key.upArrow) setMessageIndex(i => clamp(i - 1, 0, Math.max(0, messageLines.length - 1)));
				if (key.downArrow) setMessageIndex(i => clamp(i + 1, 0, Math.max(0, messageLines.length - 1)));
				if (input === '1') {
					setMessageKind('message');
					void fetchMessageTemplates('message');
				}
				if (input === '2') {
					setMessageKind('message_2');
					void fetchMessageTemplates('message_2');
				}
				if (input === 'a' || input === 'A') {
					setMessageDraft('');
					setMessageMode('create');
				}
				if (input === 'e' || input === 'E') {
					const line = messageLines[messageIndex];
					if (line === undefined) return;
					setMessageDraft(line);
					setMessageMode('edit');
				}
				if (input === 'd' || input === 'D' || key.delete || key.backspace) {
					const line = messageLines[messageIndex];
					if (line === undefined) return;
					setMessageMode('delete');
				}
				if (input === 's' || input === 'S') {
					void saveMessageTemplates(messageKind, messageLines);
				}
				return;
			}

			if (messageMode === 'delete') {
				if (key.escape || input === 'n' || input === 'N') {
					setMessageMode('list');
					return;
				}
				if (key.return || input === 'y' || input === 'Y') {
					const next = [...messageLines];
					next.splice(messageIndex, 1);
					setMessageLines(next);
					setMessageIndex(i => clamp(i, 0, Math.max(0, next.length - 1)));
					setMessageMode('list');
					void saveMessageTemplates(messageKind, next);
				}
				return;
			}

			if (messageMode === 'create' || messageMode === 'edit') {
				if (key.escape) {
					setMessageMode('list');
				}
				return;
			}
		}

		if (view !== 'main') return;

		if (key.upArrow) {
			setFocusIndex(i => {
				const next = clamp(i - 1, 0, mainFocusables.length - 1);
				setMainFocusIndex(next);
				return next;
			});
		}
		if (key.downArrow) {
			setFocusIndex(i => {
				const next = clamp(i + 1, 0, mainFocusables.length - 1);
				setMainFocusIndex(next);
				return next;
			});
		}

		if (key.escape) {
			onBack();
			return;
		}

		if (input === 'r' || input === 'R') {
			void loadSettings();
			return;
		}

		if (input === 's' || input === 'S') {
			let opened = false;
			if (currentField === 'enable_feed') {
				setMainFocusIndex(focusIndex);
				setView('feed');
				opened = true;
			}
			if (currentField === 'enable_reels') {
				setMainFocusIndex(focusIndex);
				setView('reels');
				opened = true;
			}
			if (currentField === 'watch_stories') {
				setMainFocusIndex(focusIndex);
				setView('stories');
				opened = true;
			}
			if (currentField === 'enable_follow') {
				setMainFocusIndex(focusIndex);
				setView('follow');
				opened = true;
			}
			if (currentField === 'do_unfollow') {
				setMainFocusIndex(focusIndex);
				setView('unfollow');
				opened = true;
			}
			if (currentField === 'do_message') {
				setMainFocusIndex(focusIndex);
				setView('message');
				setMessageMode('list');
				void fetchMessageTemplates(messageKind);
				opened = true;
			}
			if (currentField === 'profile_reopen_cooldown_enabled') {
				openCooldownMenu('profile_reopen');
				opened = true;
			}
			if (currentField === 'messaging_cooldown_enabled') {
				openCooldownMenu('messaging');
				opened = true;
			}
			if (opened) return;
		}

		const toggleField = (field: keyof InstagramSettings) => {
			setSettings(prev => {
				const next = {...prev, [field]: !prev[field]} as InstagramSettings;
				void persist(next);
				return next;
			});
		};

		if (currentField === 'headless' && (input === ' ' || key.return)) toggleField('headless');
		if (currentField === 'profile_reopen_cooldown_enabled' && (input === ' ' || key.return)) toggleField('profile_reopen_cooldown_enabled');
		if (currentField === 'messaging_cooldown_enabled' && (input === ' ' || key.return)) toggleField('messaging_cooldown_enabled');
		if (currentField === 'enable_feed' && (input === ' ' || key.return)) toggleField('enable_feed');
		if (currentField === 'enable_reels' && (input === ' ' || key.return)) toggleField('enable_reels');
		if (currentField === 'watch_stories' && (input === ' ' || key.return)) toggleField('watch_stories');
		if (currentField === 'enable_follow' && (input === ' ' || key.return)) toggleField('enable_follow');
		if (currentField === 'do_unfollow' && (input === ' ' || key.return)) toggleField('do_unfollow');
		if (currentField === 'do_approve' && (input === ' ' || key.return)) toggleField('do_approve');
		if (currentField === 'do_message' && (input === ' ' || key.return)) toggleField('do_message');

		if (currentField === 'source_lists' && key.return) {
			setMainFocusIndex(focusIndex);
			setView('lists');
			void fetchLists();
			return;
		}

		if (currentField === 'action_order' && key.return) {
			setMainFocusIndex(focusIndex);
			setView('order');
			setOrderIndex(0);
			return;
		}

		if (currentField === 'start_stop' && key.return) {
			if (running) stopAutomation();
			else startAutomation();
			return;
		}

		if (currentField === 'back' && key.return) {
			onBack();
		}
	});

	useEffect(() => {
		if (view === 'feed' || view === 'reels' || view === 'stories' || view === 'follow' || view === 'unfollow') {
			setFocusIndex(0);
		}
	}, [view]);

	const renderRow = (label: string, field: string, value: React.ReactNode, extra?: React.ReactNode) => {
		const focused = view === 'main' && currentField === field;
		return (
			<Box>
				<Text color={focused ? 'cyan' : 'white'}>{focused ? '> ' : '  '}</Text>
				<Box width={22}>
					<Text color={focused ? 'cyan' : 'white'}>{label}</Text>
				</Box>
				<Box>
					{value}
					{extra ? <Box marginLeft={2}>{extra}</Box> : null}
				</Box>
			</Box>
		);
	};

	const renderCheckbox = (label: string, field: string, checked: boolean, hint?: string) => {
		return renderRow(
			label,
			field,
			<Text>
				[{checked ? 'x' : ' '}] {hint ? <Text color="gray">{hint}</Text> : null}
			</Text>
		);
	};

	const renderNumberInput = (label: string, field: string, value: number) => {
		const focused = view === 'main' && currentField === field;
		return renderRow(
			label,
			field,
			focused ? (
				<TextInput
					value={String(value)}
					onChange={v => {
						const n = toInt(v, value);
						setSettings(prev => ({...prev, [field]: n} as any));
					}}
					onSubmit={v => {
						const n = toInt(v, value);
						setSettings(prev => {
							const next = {...prev, [field]: n} as InstagramSettings;
							void persist(next);
							return next;
						});
						setFocusIndex(i => {
							const next = clamp(i + 1, 0, mainFocusables.length - 1);
							setMainFocusIndex(next);
							return next;
						});
					}}
				/>
			) : (
				<Text>{value}</Text>
			)
		);
	};

	if (loading) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold>Instagram Automation</Text>
				<Text>Loading...</Text>
			</Box>
		);
	}

	if (view === 'lists') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold>Profile Source Lists</Text>
				<Text color="gray">[Up/Down] Navigate  [Space/Enter] Toggle  [R] Refresh  [Esc] Back</Text>
				<Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
					{lists.length === 0 ? (
						<Text color="gray">No lists found.</Text>
					) : (
						lists.map((l, i) => {
							const selected = settings.source_list_ids.includes(l.id);
							const focused = i === listsIndex;
							return (
								<Text key={l.id} color={focused ? 'cyan' : 'white'}>
									{focused ? '> ' : '  '}[{selected ? 'x' : ' '}] {l.name}
								</Text>
							);
						})
					)}
				</Box>
				{error ? (
					<Box marginTop={1}>
						<Text color="red">{error}</Text>
					</Box>
				) : null}
			</Box>
		);
	}

	if (view === 'order' || view === 'orderAdd') {
		if (view === 'orderAdd') {
			const candidates = ACTIONS.filter(a => enabledMap[a]);
			return (
				<Box flexDirection="column" padding={1}>
					<Text bold>Add Action</Text>
					<Text color="gray">[Up/Down] Select  [Enter] Add  [Esc] Cancel</Text>
					<Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
						{candidates.length === 0 ? (
							<Text color="gray">No enabled actions.</Text>
						) : (
							candidates.map((a, i) => (
								<Text key={`${a}-${i}`} color={i === orderAddIndex ? 'cyan' : 'white'}>
									{i === orderAddIndex ? '> ' : '  '}
									{a}
								</Text>
							))
						)}
					</Box>
				</Box>
			);
		}

		return (
			<Box flexDirection="column" padding={1}>
				<Text bold>Execution Order</Text>
				<Text color="gray">[Left/Right or Ctrl+Up/Down or Ctrl+PgUp/PgDn] Move  [A] Add  [D] Remove  [Esc] Back</Text>
				<Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
					{visibleOrder.length === 0 ? (
						<Text color="gray">No enabled actions.</Text>
					) : (
						visibleOrder.map((a, i) => (
							<Text key={`${a}-${i}`} color={i === orderIndex ? 'cyan' : 'white'}>
								{i === orderIndex ? '> ' : '  '}
								{a}
							</Text>
						))
					)}
				</Box>
			</Box>
		);
	}

	if (view === 'cooldown') {
		const opts = cooldownKind === 'profile_reopen' ? PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN : MESSAGING_COOLDOWN_OPTIONS_HOURS;
		const title = cooldownKind === 'profile_reopen' ? 'Reopen cooldown' : 'Messaging cooldown';
		const unit = cooldownKind === 'profile_reopen' ? 'min' : 'h';
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold>{title}</Text>
				<Text color="gray">[Up/Down] Select  [Enter] Set  [Esc] Back</Text>
				<Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
					{opts.map((v, i) => (
						<Text key={`${cooldownKind}-${v}`} color={i === cooldownIndex ? 'cyan' : 'white'}>
							{i === cooldownIndex ? '> ' : '  '}
							{v} {unit}
						</Text>
					))}
				</Box>
			</Box>
		);
	}

	if (view === 'feed' || view === 'reels' || view === 'stories' || view === 'follow' || view === 'unfollow') {
		const fieldsByView: Record<string, {key: keyof InstagramSettings; label: string; kind: 'int' | 'float' | 'percent'}[]> = {
			feed: [
				{key: 'feed_min_time_minutes', label: 'Min time (min)', kind: 'int'},
				{key: 'feed_max_time_minutes', label: 'Max time (min)', kind: 'int'},
				{key: 'like_chance', label: 'Likes chance', kind: 'percent'},
				{key: 'follow_chance', label: 'Follow chance', kind: 'percent'},
				{key: 'carousel_watch_chance', label: 'Carousel chance', kind: 'percent'},
				{key: 'carousel_max_slides', label: 'Carousel max slides', kind: 'int'},
			],
			reels: [
				{key: 'reels_min_time_minutes', label: 'Min time (min)', kind: 'int'},
				{key: 'reels_max_time_minutes', label: 'Max time (min)', kind: 'int'},
				{key: 'reels_like_chance', label: 'Likes chance', kind: 'percent'},
				{key: 'reels_follow_chance', label: 'Follow chance', kind: 'percent'},
				{key: 'reels_skip_chance', label: 'Skip chance', kind: 'percent'},
				{key: 'reels_skip_min_time', label: 'Skip min (sec)', kind: 'float'},
				{key: 'reels_skip_max_time', label: 'Skip max (sec)', kind: 'float'},
				{key: 'reels_normal_min_time', label: 'Normal min (sec)', kind: 'float'},
				{key: 'reels_normal_max_time', label: 'Normal max (sec)', kind: 'float'},
			],
			stories: [{key: 'stories_max', label: 'Max stories', kind: 'int'}],
			follow: [
				{key: 'highlights_min', label: 'Highlights min', kind: 'int'},
				{key: 'highlights_max', label: 'Highlights max', kind: 'int'},
				{key: 'likes_percentage', label: 'Likes (% posts)', kind: 'int'},
				{key: 'scroll_percentage', label: 'Scroll (% posts)', kind: 'int'},
				{key: 'following_limit', label: 'Target following limit', kind: 'int'},
				{key: 'follow_min_count', label: 'Follow min/session', kind: 'int'},
				{key: 'follow_max_count', label: 'Follow max/session', kind: 'int'},
			],
			unfollow: [
				{key: 'min_delay', label: 'Delay min (sec)', kind: 'int'},
				{key: 'max_delay', label: 'Delay max (sec)', kind: 'int'},
				{key: 'unfollow_min_count', label: 'Unfollow min/session', kind: 'int'},
				{key: 'unfollow_max_count', label: 'Unfollow max/session', kind: 'int'},
			],
		};

		const fields = fieldsByView[view];
		const focusedKey = fields[focusIndex]?.key;

		return (
			<Box flexDirection="column" padding={1}>
				<Text bold>
					{view === 'feed'
						? 'Feed Settings'
						: view === 'reels'
							? 'Reels Settings'
							: view === 'stories'
								? 'Stories Settings'
								: view === 'follow'
									? 'Follow Settings'
									: 'Unfollow Settings'}
				</Text>
				<Text color="gray">
					[Up/Down] Navigate{' '}
					{fields.some(f => f.kind === 'percent') ? '[Left/Right] Change % ' : ''}
					[Esc] Back
				</Text>
				<Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
					{fields.map((f, i) => {
						const focused = i === focusIndex;
						const value = (settings as any)[f.key];
						return (
							<Box key={f.key as string}>
								<Text color={focused ? 'cyan' : 'white'}>{focused ? '> ' : '  '}</Text>
								<Box width={22}>
									<Text color={focused ? 'cyan' : 'white'}>{f.label}</Text>
								</Box>
								{f.kind === 'percent' ? (
									<Text>{value}%</Text>
								) : (
									<TextInput
										value={String(value)}
										focus={focused}
										onChange={v => {
											setSettings(prev => {
												const nextVal = f.kind === 'float' ? toFloat(v, value) : toInt(v, value);
												return {...prev, [f.key]: nextVal} as any;
											});
										}}
										onSubmit={v => {
											setSettings(prev => {
												const nextVal = f.kind === 'float' ? toFloat(v, value) : toInt(v, value);
												const next = {...prev, [f.key]: nextVal} as InstagramSettings;
												void persist(next);
												return next;
											});
											setFocusIndex(i => clamp(i + 1, 0, fields.length - 1));
										}}
									/>
								)}
								{focused && f.kind === 'percent' ? (
									<Box marginLeft={2}>
										<Text color="gray">Use ←/→</Text>
									</Box>
								) : null}
								{focused && focusedKey === f.key && saving ? (
									<Box marginLeft={2}>
										<Text color="yellow">Saving...</Text>
									</Box>
								) : null}
							</Box>
						);
					})}
				</Box>
				{error ? (
					<Box marginTop={1}>
						<Text color="red">{error}</Text>
					</Box>
				) : null}
			</Box>
		);
	}

	if (view === 'message') {
		if (messageMode === 'delete') {
			return (
				<Box flexDirection="column" padding={1} borderStyle="single" borderColor="red">
					<Text bold color="red">
						Delete Message
					</Text>
					<Box marginTop={1}>
						<Text>Delete: </Text>
						<Text color="yellow">{messageLines[messageIndex] || ''}</Text>
					</Box>
					<Box marginTop={1}>
						<Text color="gray">[Y]es / [N]o / [Esc] Cancel</Text>
					</Box>
				</Box>
			);
		}

		if (messageMode === 'create' || messageMode === 'edit') {
			return (
				<Box flexDirection="column" padding={1}>
					<Text bold>{messageMode === 'create' ? 'Add Message' : 'Edit Message'}</Text>
					<Text color="gray">[Enter] Save  [Esc] Cancel</Text>
					<Box marginTop={1}>
						<Text>Text: </Text>
						<TextInput
							value={messageDraft}
							onChange={setMessageDraft}
							onSubmit={val => {
								const trimmed = val.trim();
								if (!trimmed) {
									setMessageMode('list');
									return;
								}
								const next = [...messageLines];
								if (messageMode === 'create') next.push(trimmed);
								else next[messageIndex] = trimmed;
								setMessageLines(next);
								setMessageMode('list');
								void saveMessageTemplates(messageKind, next);
							}}
						/>
					</Box>
				</Box>
			);
		}

		return (
			<Box flexDirection="column" padding={1}>
				<Text bold>Message Templates</Text>
				<Text color="gray">[1]/[2] Kind  [A] Add  [E] Edit  [D] Delete  [S] Save  [Esc] Back</Text>
				<Box marginTop={1}>
					<Text>
						Kind: <Text color="cyan">{messageKind}</Text>
					</Text>
				</Box>
				<Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
					{messageLines.length === 0 ? (
						<Text color="gray">No messages.</Text>
					) : (
						messageLines.map((m, i) => (
							<Text key={`${m}-${i}`} color={i === messageIndex ? 'cyan' : 'white'}>
								{i === messageIndex ? '> ' : '  '}
								{m}
							</Text>
						))
					)}
				</Box>
				{error ? (
					<Box marginTop={1}>
						<Text color="red">{error}</Text>
					</Box>
				) : null}
			</Box>
		);
	}

	const listCount = settings.source_list_ids.length;

	return (
		<Box flexDirection="column" padding={1} borderColor="gray" borderStyle="single">
			<Box justifyContent="space-between">
				<Text bold>Instagram Automation</Text>
				<Text color="gray">
					[Esc] Back [R] Reload [Up/Down] Navigate [Space/Enter] Toggle [S] Settings
				</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text underline>Runtime</Text>
				{renderNumberInput('Max sessions', 'max_sessions', settings.max_sessions)}
				{renderNumberInput('Parallel profiles', 'parallel_profiles', settings.parallel_profiles)}
				{renderCheckbox('Headless', 'headless', settings.headless)}
				{renderCheckbox('Reopen cooldown', 'profile_reopen_cooldown_enabled', settings.profile_reopen_cooldown_enabled, '[S]')}
				{renderCheckbox('Messaging cooldown', 'messaging_cooldown_enabled', settings.messaging_cooldown_enabled, '[S]')}
				{renderRow(
					'Source lists',
					'source_lists',
					<Text>
						{listCount === 0 ? <Text color="yellow">None</Text> : <Text color="green">{listCount} selected</Text>}
						<Text color="gray"> (Enter)</Text>
					</Text>
				)}
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text underline>Activities</Text>
				{renderCheckbox('Feed', 'enable_feed', settings.enable_feed, '[S]')}
				{renderCheckbox('Reels', 'enable_reels', settings.enable_reels, '[S]')}
				{renderCheckbox('Stories', 'watch_stories', settings.watch_stories, '[S]')}
				{renderCheckbox('Follow', 'enable_follow', settings.enable_follow, '[S]')}
				{renderCheckbox('Unfollow', 'do_unfollow', settings.do_unfollow, '[S]')}
				{renderCheckbox('Approve', 'do_approve', settings.do_approve)}
				{renderCheckbox('Message', 'do_message', settings.do_message, '[S]')}
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text underline>Order</Text>
				{renderRow(
					'Action order',
					'action_order',
					<Text>
						<Text color={visibleOrder.length === 0 ? 'yellow' : 'green'}>{visibleOrder.length} enabled</Text>
						<Text color="gray"> (Enter)</Text>
					</Text>
				)}
			</Box>

			<Box marginTop={1} borderStyle="single" borderColor={running ? 'green' : 'red'} paddingX={1}>
				<Text color={currentField === 'start_stop' ? 'cyan' : 'white'}>
					{currentField === 'start_stop' ? '> ' : '  '}
					{running ? 'STOP AUTOMATION' : 'START AUTOMATION'}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text>
					Status:{' '}
					<Text color={running ? 'green' : 'yellow'}>{running ? 'Running' : 'Stopped'}</Text>
					{saving ? <Text color="yellow">  Saving...</Text> : null}
				</Text>
			</Box>

			{error ? (
				<Box marginTop={1}>
					<Text color="red">{error}</Text>
				</Box>
			) : null}

			<Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
				<Text bold>Last log</Text>
				{lastLogs.length === 0 ? <Text color="gray">No logs yet.</Text> : <Text>{lastLogs[0]}</Text>}
			</Box>
		</Box>
	);
}
