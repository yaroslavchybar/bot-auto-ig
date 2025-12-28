import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useInput } from 'ink';
import {
    profilesClearBusyForLists,
} from '../../lib/supabase.js';
import { listsService } from '../../lib/listsService.js';
import { messagesService } from '../../lib/messagesService.js';
import { getLogs, subscribeLogs, appendLog } from '../../lib/logStore.js';
import { automationService } from '../../lib/automationService.js';
import { useInstagramSettings } from './hooks/useInstagramSettings.js';
import { clamp, nextPercent } from '../../lib/utils.js';
import { InstagramSettings, ACTIONS, ActionName } from '../../types/index.js';

// Views
import { MainView } from './Views/MainView.js';
import { ListView } from './Views/ListView.js';
import { CooldownView } from './Views/CooldownView.js';
import { OrderView, OrderAddView } from './Views/OrderView.js';
import { SubSettingsView } from './Views/SubSettingsView.js';
import { MessageView } from './Views/MessageView.js';

export type View =
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

type Props = {
    onBack: () => void;
    initialMainFocusIndex: number;
    onMainFocusIndexChange: (index: number) => void;
};

const PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN = [5, 10, 15, 30, 45, 60, 90, 120];
const MESSAGING_COOLDOWN_OPTIONS_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];

export default function Instagram({ onBack, initialMainFocusIndex, onMainFocusIndexChange }: Props) {
    const { settings, loading, saving, error, load, updateSettings, setSettings, setError } = useInstagramSettings();
    const [view, setView] = useState<View>('main');
    const [focusIndex, setFocusIndex] = useState(initialMainFocusIndex);
    const [mainFocusIndex, setMainFocusIndex] = useState(initialMainFocusIndex);

    const [lists, setLists] = useState<any[]>([]);
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

    const [running, setRunning] = useState(automationService.isRunning);
    const [logTick, setLogTick] = useState(0);

    const [progress, setProgress] = useState<{
        totalAccounts: number;
        completedAccounts: number;
        currentProfile: string | null;
        currentTask: string | null;
    }>({
        totalAccounts: 0,
        completedAccounts: 0,
        currentProfile: null,
        currentTask: null,
    });

    const onMainFocusIndexChangeRef = useRef(onMainFocusIndexChange);

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
        return settings.action_order.filter(a => (enabledMap as any)[a]);
    }, [settings.action_order, enabledMap]);

    const lastLog = useMemo(() => {
        const all = getLogs();
        return all.length > 0 ? all[all.length - 1]?.message : null;
    }, [logTick]);

    useEffect(() => {
        const lChange = (l: any) => setLists(l);
        const lError = (e: any) => setError(e);
        listsService.on('change', lChange);
        listsService.on('error', lError);

        const mChange = ({ kind, lines }: any) => {
            if (kind === messageKind) {
                setMessageLines(lines);
            }
        };
        const mError = (e: any) => setError(e);
        messagesService.on('change', mChange);
        messagesService.on('error', mError);

        return () => {
            listsService.off('change', lChange);
            listsService.off('error', lError);
            messagesService.off('change', mChange);
            messagesService.off('error', mError);
        };
    }, [messageKind]);

    const fetchLists = async () => {
        setListsIndex(0);
        await listsService.refresh();
    };

    const fetchMessageTemplates = async (kind: 'message' | 'message_2') => {
        setMessageIndex(0);
        await messagesService.fetchTemplates(kind);
    };

    const saveMessageTemplatesLocal = async (kind: 'message' | 'message_2', lines: string[]) => {
        await messagesService.saveTemplates(kind, lines);
    };

    const clearBusyProfiles = async () => {
        const listIds = Array.isArray(settings.source_list_ids) ? settings.source_list_ids : [];
        if (listIds.length === 0) return;
        try {
            await profilesClearBusyForLists(listIds);
        } catch { }
    };

    const startAutomation = (override?: InstagramSettings) => {
        if (automationService.isRunning) return;
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

        const nextSettings = runSettings.automation_enabled ? runSettings : { ...runSettings, automation_enabled: true };
        if (!runSettings.automation_enabled) {
            updateSettings(nextSettings);
        }

        automationService.start(nextSettings).catch(err => {
            setError(err.message);
        });
        setRunning(true);
    };

    const stopAutomation = () => {
        updateSettings(prev => ({ ...prev, automation_enabled: false }));
        appendLog('Stopping automation...', 'instagram');
        automationService.stop();
        void clearBusyProfiles();
        setRunning(false);
    };

    useEffect(() => {
        return subscribeLogs(() => setLogTick(v => v + 1));
    }, []);

    useEffect(() => {
        const statusHandler = (status: any) => {
            setRunning(status === 'running' || status === 'starting');
            if (status === 'error' && automationService.error) {
                setError(automationService.error);
            }
        };
        const exitHandler = () => {
            void clearBusyProfiles();
        };

        const eventHandler = (event: any) => {
            if (event.type === 'session_started') {
                setProgress({
                    totalAccounts: event.total_accounts,
                    completedAccounts: 0,
                    currentProfile: null,
                    currentTask: null,
                });
            } else if (event.type === 'profile_started') {
                setProgress(prev => ({ ...prev, currentProfile: event.profile, currentTask: null }));
            } else if (event.type === 'task_started') {
                setProgress(prev => ({ ...prev, currentTask: event.task }));
            } else if (event.type === 'profile_completed') {
                setProgress(prev => ({
                    ...prev,
                    completedAccounts: prev.completedAccounts + 1,
                    currentProfile: null,
                    currentTask: null,
                }));
            } else if (event.type === 'session_ended') {
                // Keep progress for a bit? Or reset?
            }
        };

        automationService.on('statusChange', statusHandler);
        automationService.on('exit', exitHandler);
        automationService.on('event', eventHandler);

        return () => {
            automationService.off('statusChange', statusHandler);
            automationService.off('exit', exitHandler);
            automationService.off('event', eventHandler);
        };
    }, [settings.source_list_ids]);

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

        const currentField = mainFocusables[focusIndex] || 'max_sessions';

        if (view === 'main') {
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
                void load();
                return;
            }
            if (input === ' ' || key.return) {
                if (currentField === 'headless') updateSettings(prev => ({ ...prev, headless: !prev.headless }));
                if (currentField === 'profile_reopen_cooldown_enabled') updateSettings(prev => ({ ...prev, profile_reopen_cooldown_enabled: !prev.profile_reopen_cooldown_enabled }));
                if (currentField === 'messaging_cooldown_enabled') updateSettings(prev => ({ ...prev, messaging_cooldown_enabled: !prev.messaging_cooldown_enabled }));
                if (currentField === 'source_lists') {
                    setMainFocusIndex(focusIndex);
                    void fetchLists();
                    setView('lists');
                }
                if (currentField === 'enable_feed') updateSettings(prev => ({ ...prev, enable_feed: !prev.enable_feed }));
                if (currentField === 'enable_reels') updateSettings(prev => ({ ...prev, enable_reels: !prev.enable_reels }));
                if (currentField === 'watch_stories') updateSettings(prev => ({ ...prev, watch_stories: !prev.watch_stories }));
                if (currentField === 'enable_follow') updateSettings(prev => ({ ...prev, enable_follow: !prev.enable_follow }));
                if (currentField === 'do_unfollow') updateSettings(prev => ({ ...prev, do_unfollow: !prev.do_unfollow }));
                if (currentField === 'do_approve') updateSettings(prev => ({ ...prev, do_approve: !prev.do_approve }));
                if (currentField === 'do_message') updateSettings(prev => ({ ...prev, do_message: !prev.do_message }));
                if (currentField === 'action_order') {
                    setMainFocusIndex(focusIndex);
                    setOrderIndex(0);
                    setView('order');
                }
                if (currentField === 'start_stop') {
                    if (running) stopAutomation();
                    else startAutomation();
                }
                if (currentField === 'back') onBack();
            }
            if (input === 's' || input === 'S') {
                if (currentField === 'profile_reopen_cooldown_enabled') {
                    setMainFocusIndex(focusIndex);
                    setCooldownKind('profile_reopen');
                    const opts = PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN;
                    const idx = opts.findIndex(v => v === settings.profile_reopen_cooldown_minutes);
                    setCooldownIndex(idx >= 0 ? idx : 0);
                    setView('cooldown');
                }
                if (currentField === 'messaging_cooldown_enabled') {
                    setMainFocusIndex(focusIndex);
                    setCooldownKind('messaging');
                    const opts = MESSAGING_COOLDOWN_OPTIONS_HOURS;
                    const idx = opts.findIndex(v => v === settings.messaging_cooldown_hours);
                    setCooldownIndex(idx >= 0 ? idx : 0);
                    setView('cooldown');
                }
                if (currentField === 'enable_feed') { setMainFocusIndex(focusIndex); setFocusIndex(0); setView('feed'); }
                if (currentField === 'enable_reels') { setMainFocusIndex(focusIndex); setFocusIndex(0); setView('reels'); }
                if (currentField === 'watch_stories') { setMainFocusIndex(focusIndex); setFocusIndex(0); setView('stories'); }
                if (currentField === 'enable_follow') { setMainFocusIndex(focusIndex); setFocusIndex(0); setView('follow'); }
                if (currentField === 'do_unfollow') { setMainFocusIndex(focusIndex); setFocusIndex(0); setView('unfollow'); }
                if (currentField === 'do_message') {
                    setMainFocusIndex(focusIndex);
                    void fetchMessageTemplates('message');
                    setView('message');
                }
            }
        } else if (view === 'lists') {
            if (key.escape) { setView('main'); setFocusIndex(mainFocusIndex); return; }
            if (key.upArrow) setListsIndex(i => clamp(i - 1, 0, Math.max(0, lists.length - 1)));
            if (key.downArrow) setListsIndex(i => clamp(i + 1, 0, Math.max(0, lists.length - 1)));
            if (input === 'r' || input === 'R') void fetchLists();
            if (input === ' ' || key.return) {
                const row = lists[listsIndex];
                if (!row) return;
                updateSettings(prev => {
                    const set = new Set(prev.source_list_ids);
                    if (set.has(row.id)) set.delete(row.id);
                    else set.add(row.id);
                    return { ...prev, source_list_ids: [...set] };
                });
            }
        } else if (view === 'cooldown') {
            const opts = cooldownKind === 'profile_reopen' ? PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN : MESSAGING_COOLDOWN_OPTIONS_HOURS;
            if (key.escape) { setView('main'); setFocusIndex(mainFocusIndex); return; }
            if (key.upArrow) setCooldownIndex(i => clamp(i - 1, 0, Math.max(0, opts.length - 1)));
            if (key.downArrow) setCooldownIndex(i => clamp(i + 1, 0, Math.max(0, opts.length - 1)));
            if (key.return || input === ' ') {
                const selected = opts[cooldownIndex];
                if (selected !== undefined) {
                    updateSettings(prev => {
                        return cooldownKind === 'profile_reopen'
                            ? { ...prev, profile_reopen_cooldown_minutes: selected }
                            : { ...prev, messaging_cooldown_hours: selected };
                    });
                }
                setView('main');
                setFocusIndex(mainFocusIndex);
            }
        } else if (view === 'order') {
            if (key.escape) { setView('main'); setFocusIndex(mainFocusIndex); return; }
            if (key.upArrow) setOrderIndex(i => clamp(i - 1, 0, Math.max(0, visibleOrder.length - 1)));
            if (key.downArrow) setOrderIndex(i => clamp(i + 1, 0, Math.max(0, visibleOrder.length - 1)));

            const move = (dir: number) => {
                const action = visibleOrder[orderIndex];
                if (!action) return;
                const visible = settings.action_order.filter(a => (enabledMap as any)[a]);
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
                    if ((enabledMap as any)[a]) {
                        nextOrder.push(swapped[vi] as ActionName);
                        vi += 1;
                    } else {
                        nextOrder.push(a);
                    }
                }
                updateSettings(prev => ({ ...prev, action_order: nextOrder }));
                setOrderIndex(clamp(orderIndex + dir, 0, Math.max(0, visibleOrder.length - 1)));
            };

            if (key.ctrl && key.upArrow) move(-1);
            if (key.ctrl && key.downArrow) move(1);
            if (key.leftArrow) move(-1);
            if (key.rightArrow) move(1);

            if (input === 'd' || input === 'D' || key.delete || key.backspace) {
                const action = visibleOrder[orderIndex];
                if (!action) return;
                const idx = settings.action_order.indexOf(action);
                if (idx < 0) return;
                const nextOrder = [...settings.action_order];
                nextOrder.splice(idx, 1);
                updateSettings(prev => ({ ...prev, action_order: nextOrder }));
                setOrderIndex(i => clamp(i, 0, Math.max(0, visibleOrder.length - 2)));
            }
            if (input === 'a' || input === 'A') {
                setOrderAddIndex(0);
                setView('orderAdd');
            }
        } else if (view === 'orderAdd') {
            if (key.escape) { setView('order'); return; }
            const candidates = ACTIONS.filter(a => (enabledMap as any)[a]);
            if (key.upArrow) setOrderAddIndex(i => clamp(i - 1, 0, Math.max(0, candidates.length - 1)));
            if (key.downArrow) setOrderAddIndex(i => clamp(i + 1, 0, Math.max(0, candidates.length - 1)));
            if (key.return) {
                const action = candidates[orderAddIndex];
                if (!action) return;
                updateSettings(prev => ({ ...prev, action_order: [...prev.action_order, action] }));
                setView('order');
            }
        } else if (['feed', 'reels', 'stories', 'follow', 'unfollow'].includes(view)) {
            if (key.escape) { setView('main'); setFocusIndex(mainFocusIndex); return; }
            // Logic for Left/Right percent change would go here or in SubSettingsView
            // For simplicity, let's keep it here for now as it needs setSettings
            const fieldsByView: Record<string, string[]> = {
                feed: ['feed_min_time_minutes', 'feed_max_time_minutes', 'like_chance', 'follow_chance', 'carousel_watch_chance', 'carousel_max_slides'],
                reels: ['reels_min_time_minutes', 'reels_max_time_minutes', 'reels_like_chance', 'reels_follow_chance', 'reels_skip_chance', 'reels_skip_min_time', 'reels_skip_max_time', 'reels_normal_min_time', 'reels_normal_max_time'],
                stories: ['stories_max'],
                follow: ['highlights_min', 'highlights_max', 'likes_percentage', 'scroll_percentage', 'following_limit', 'follow_min_count', 'follow_max_count'],
                unfollow: ['min_delay', 'max_delay', 'unfollow_min_count', 'unfollow_max_count'],
            };
            const fields = fieldsByView[view] || [];
            if (key.upArrow) setFocusIndex(i => clamp(i - 1, 0, Math.max(0, fields.length - 1)));
            if (key.downArrow) setFocusIndex(i => clamp(i + 1, 0, Math.max(0, fields.length - 1)));

            const field = fields[focusIndex];
            if (['like_chance', 'follow_chance', 'carousel_watch_chance', 'reels_like_chance', 'reels_follow_chance', 'reels_skip_chance'].includes(field!)) {
                if (key.leftArrow) updateSettings(prev => ({ ...prev, [field!]: nextPercent((prev as any)[field!], -1) }));
                if (key.rightArrow) updateSettings(prev => ({ ...prev, [field!]: nextPercent((prev as any)[field!], 1) }));
            }
        } else if (view === 'message') {
            if (messageMode === 'list') {
                if (key.escape) { setView('main'); setFocusIndex(mainFocusIndex); return; }
                if (key.upArrow) setMessageIndex(i => clamp(i - 1, 0, Math.max(0, messageLines.length - 1)));
                if (key.downArrow) setMessageIndex(i => clamp(i + 1, 0, Math.max(0, messageLines.length - 1)));
                if (input === '1') { setMessageKind('message'); void fetchMessageTemplates('message'); }
                if (input === '2') { setMessageKind('message_2'); void fetchMessageTemplates('message_2'); }
                if (input === 'a' || input === 'A') { setMessageDraft(''); setMessageMode('create'); }
                if (input === 'e' || input === 'E') {
                    const line = messageLines[messageIndex];
                    if (line) { setMessageDraft(line); setMessageMode('edit'); }
                }
                if (input === 'd' || input === 'D' || key.delete || key.backspace) if (messageLines[messageIndex]) setMessageMode('delete');
                if (input === 's' || input === 'S') void saveMessageTemplatesLocal(messageKind, messageLines);
            } else if (messageMode === 'delete') {
                if (key.escape || input === 'n' || input === 'N') setMessageMode('list');
                if (key.return || input === 'y' || input === 'Y') {
                    const next = [...messageLines];
                    next.splice(messageIndex, 1);
                    setMessageLines(next);
                    setMessageIndex(i => clamp(i, 0, Math.max(0, next.length - 1)));
                    setMessageMode('list');
                    void saveMessageTemplatesLocal(messageKind, next);
                }
            } else if (messageMode === 'create' || messageMode === 'edit') {
                if (key.escape) setMessageMode('list');
            }
        }
    });

    if (loading) return null; // Or some loading indicator

    if (view === 'main') {
        return (
            <MainView
                settings={settings}
                focusIndex={focusIndex}
                mainFocusFocusables={mainFocusables}
                running={running}
                progress={progress}
                saving={saving}
                error={error}
                lastLog={lastLog}
                onUpdate={updateSettings}
            />
        );
    }

    if (view === 'lists') {
        return <ListView lists={lists} selectedIds={settings.source_list_ids} index={listsIndex} error={error} />;
    }

    if (view === 'cooldown') {
        const opts = cooldownKind === 'profile_reopen' ? PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN : MESSAGING_COOLDOWN_OPTIONS_HOURS;
        return <CooldownView kind={cooldownKind} options={opts} index={cooldownIndex} />;
    }

    if (view === 'order') {
        return <OrderView visibleOrder={visibleOrder} index={orderIndex} />;
    }

    if (view === 'orderAdd') {
        const candidates = ACTIONS.filter(a => (enabledMap as any)[a]);
        return <OrderAddView candidates={candidates} index={orderAddIndex} />;
    }

    if (['feed', 'reels', 'stories', 'follow', 'unfollow'].includes(view)) {
        return (
            <SubSettingsView
                view={view as any}
                settings={settings}
                focusIndex={focusIndex}
                saving={saving}
                error={error}
                onUpdate={updateSettings}
                onFocusChange={setFocusIndex}
            />
        );
    }

    if (view === 'message') {
        return (
            <MessageView
                mode={messageMode}
                kind={messageKind}
                lines={messageLines}
                index={messageIndex}
                draft={messageDraft}
                onDraftChange={setMessageDraft}
                onSubmitDraft={val => {
                    const trimmed = val.trim();
                    if (!trimmed) { setMessageMode('list'); return; }
                    const next = [...messageLines];
                    if (messageMode === 'create') next.push(trimmed);
                    else next[messageIndex] = trimmed;
                    setMessageLines(next);
                    setMessageMode('list');
                    void saveMessageTemplatesLocal(messageKind, next);
                }}
            />
        );
    }

    return null;
}
