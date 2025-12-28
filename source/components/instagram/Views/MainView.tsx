import React from 'react';
import { Box, Text } from 'ink';
import { InstagramSettings } from '../../../types/index.js';
import { Checkbox } from '../../ui/Checkbox.js';
import { NumberInput } from '../../ui/NumberInput.js';
import { Row } from '../../ui/Row.js';
import { toInt } from '../../../lib/utils.js';
import { ProgressBar } from '../../ui/ProgressBar.js';

interface Props {
    settings: InstagramSettings;
    focusIndex: number;
    mainFocusFocusables: string[];
    running: boolean;
    saving: boolean;
    error: string | null;
    lastLog: string | null;
    progress: {
        totalAccounts: number;
        completedAccounts: number;
        currentProfile: string | null;
        currentTask: string | null;
    };
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings), persist?: boolean) => void;
}

export function MainView({ settings, focusIndex, mainFocusFocusables, running, progress, saving, error, lastLog, onUpdate }: Props) {
    const currentField = mainFocusFocusables[focusIndex];
    const listCount = settings.source_list_ids.length;

    const renderCheckbox = (label: string, field: keyof InstagramSettings, hint?: string) => (
        <Checkbox
            label={label}
            checked={!!settings[field]}
            focused={currentField === field}
            hint={hint}
        />
    );

    const renderNumberInput = (label: string, field: keyof InstagramSettings) => (
        <NumberInput
            label={label}
            value={settings[field] as number}
            focused={currentField === field}
            onChange={v => onUpdate(prev => ({ ...prev, [field]: toInt(v, settings[field] as number) }), false)}
            onSubmit={v => onUpdate(prev => ({ ...prev, [field]: toInt(v, settings[field] as number) }), true)}
        />
    );

    // Calculate visibleOrder for the summary
    const enabledMap = {
        'Feed Scroll': settings.enable_feed,
        'Reels Scroll': settings.enable_reels,
        'Watch Stories': settings.watch_stories,
        'Follow': settings.enable_follow,
        'Unfollow': settings.do_unfollow,
        'Approve Requests': settings.do_approve,
        'Send Messages': settings.do_message,
    };
    const currentVisibleOrder = settings.action_order.filter(a => (enabledMap as any)[a]);

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
                {renderNumberInput('Max sessions', 'max_sessions')}
                {renderNumberInput('Parallel profiles', 'parallel_profiles')}
                {renderCheckbox('Headless', 'headless')}
                {renderCheckbox('Reopen cooldown', 'profile_reopen_cooldown_enabled', '[S]')}
                {renderCheckbox('Messaging cooldown', 'messaging_cooldown_enabled', '[S]')}
                <Row
                    label="Source lists"
                    focused={currentField === 'source_lists'}
                >
                    <Text>
                        {listCount === 0 ? <Text color="yellow">None</Text> : <Text color="green">{listCount} selected</Text>}
                        <Text color="gray"> (Enter)</Text>
                    </Text>
                </Row>
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text underline>Activities</Text>
                {renderCheckbox('Feed', 'enable_feed', '[S]')}
                {renderCheckbox('Reels', 'enable_reels', '[S]')}
                {renderCheckbox('Stories', 'watch_stories', '[S]')}
                {renderCheckbox('Follow', 'enable_follow', '[S]')}
                {renderCheckbox('Unfollow', 'do_unfollow', '[S]')}
                {renderCheckbox('Approve', 'do_approve')}
                {renderCheckbox('Message', 'do_message', '[S]')}
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text underline>Order</Text>
                <Row label="Action order" focused={currentField === 'action_order'}>
                    <Text>
                        <Text color={currentVisibleOrder.length === 0 ? 'yellow' : 'green'}>{currentVisibleOrder.length} enabled</Text>
                        <Text color="gray"> (Enter)</Text>
                    </Text>
                </Row>
            </Box>

            <Box marginTop={1} borderStyle="single" borderColor={running ? 'green' : 'red'} paddingX={1}>
                <Text color={currentField === 'start_stop' ? 'cyan' : 'white'}>
                    {currentField === 'start_stop' ? '> ' : '  '}
                    {running ? 'STOP AUTOMATION' : 'START AUTOMATION'}
                </Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text>
                    Status:{' '}
                    <Text color={running ? 'green' : 'yellow'}>{running ? 'Running' : 'Stopped'}</Text>
                    {saving ? <Text color="yellow">  Saving...</Text> : null}
                </Text>

                {running && progress.totalAccounts > 0 && (
                    <Box marginTop={1} flexDirection="column">
                        <ProgressBar
                            label="Overall Progress"
                            current={progress.completedAccounts}
                            total={progress.totalAccounts}
                        />
                        {progress.currentProfile && (
                            <Text color="cyan">
                                Current Profile: @{progress.currentProfile}
                                {progress.currentTask ? <Text color="yellow"> ({progress.currentTask})</Text> : null}
                            </Text>
                        )}
                    </Box>
                )}
            </Box>

            {error ? (
                <Box marginTop={1}>
                    <Text color="red">{error}</Text>
                </Box>
            ) : null}

            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
                <Text bold>Last log</Text>
                {!lastLog ? <Text color="gray">No logs yet.</Text> : <Text>{lastLog}</Text>}
            </Box>
        </Box>
    );
}
