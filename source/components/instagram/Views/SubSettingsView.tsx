import React from 'react';
import { Box, Text } from 'ink';
import { InstagramSettings } from '../../../types/index.js';
import TextInput from 'ink-text-input';
import { clamp, toInt, toFloat } from '../../../lib/utils.js';

export type SubSettingKind = 'int' | 'float' | 'percent';

export interface FieldDef {
    key: keyof InstagramSettings;
    label: string;
    kind: SubSettingKind;
}

interface Props {
    view: 'feed' | 'reels' | 'stories' | 'follow' | 'unfollow';
    settings: InstagramSettings;
    focusIndex: number;
    saving: boolean;
    error: string | null;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings), persist?: boolean) => void;
    onFocusChange: (index: number) => void;
}

export function SubSettingsView({ view, settings, focusIndex, saving, error, onUpdate, onFocusChange }: Props) {
    const fieldsByView: Record<string, FieldDef[]> = {
        feed: [
            { key: 'feed_min_time_minutes', label: 'Min time (min)', kind: 'int' },
            { key: 'feed_max_time_minutes', label: 'Max time (min)', kind: 'int' },
            { key: 'like_chance', label: 'Likes chance', kind: 'percent' },
            { key: 'follow_chance', label: 'Follow chance', kind: 'percent' },
            { key: 'carousel_watch_chance', label: 'Carousel chance', kind: 'percent' },
            { key: 'carousel_max_slides', label: 'Carousel max slides', kind: 'int' },
        ],
        reels: [
            { key: 'reels_min_time_minutes', label: 'Min time (min)', kind: 'int' },
            { key: 'reels_max_time_minutes', label: 'Max time (min)', kind: 'int' },
            { key: 'reels_like_chance', label: 'Likes chance', kind: 'percent' },
            { key: 'reels_follow_chance', label: 'Follow chance', kind: 'percent' },
            { key: 'reels_skip_chance', label: 'Skip chance', kind: 'percent' },
            { key: 'reels_skip_min_time', label: 'Skip min (sec)', kind: 'float' },
            { key: 'reels_skip_max_time', label: 'Skip max (sec)', kind: 'float' },
            { key: 'reels_normal_min_time', label: 'Normal min (sec)', kind: 'float' },
            { key: 'reels_normal_max_time', label: 'Normal max (sec)', kind: 'float' },
        ],
        stories: [{ key: 'stories_max', label: 'Max stories', kind: 'int' }],
        follow: [
            { key: 'highlights_min', label: 'Highlights min', kind: 'int' },
            { key: 'highlights_max', label: 'Highlights max', kind: 'int' },
            { key: 'likes_percentage', label: 'Likes (% posts)', kind: 'int' },
            { key: 'scroll_percentage', label: 'Scroll (% posts)', kind: 'int' },
            { key: 'following_limit', label: 'Target following limit', kind: 'int' },
            { key: 'follow_min_count', label: 'Follow min/session', kind: 'int' },
            { key: 'follow_max_count', label: 'Follow max/session', kind: 'int' },
        ],
        unfollow: [
            { key: 'min_delay', label: 'Delay min (sec)', kind: 'int' },
            { key: 'max_delay', label: 'Delay max (sec)', kind: 'int' },
            { key: 'unfollow_min_count', label: 'Unfollow min/session', kind: 'int' },
            { key: 'unfollow_max_count', label: 'Unfollow max/session', kind: 'int' },
        ],
    };

    const fields = fieldsByView[view] || [];
    const focusedKey = fields[focusIndex]?.key;

    const title = view.charAt(0).toUpperCase() + view.slice(1) + ' Settings';

    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>{title}</Text>
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
                                        onUpdate(prev => {
                                            const nextVal = f.kind === 'float' ? toFloat(v, value) : toInt(v, value);
                                            return { ...prev, [f.key]: nextVal } as any;
                                        }, false);
                                    }}
                                    onSubmit={v => {
                                        onUpdate(prev => {
                                            const nextVal = f.kind === 'float' ? toFloat(v, value) : toInt(v, value);
                                            return { ...prev, [f.key]: nextVal } as any;
                                        }, true);
                                        onFocusChange(clamp(i + 1, 0, fields.length - 1));
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
