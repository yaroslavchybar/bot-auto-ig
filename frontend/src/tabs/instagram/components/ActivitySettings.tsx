import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Settings } from 'lucide-react';
import type { InstagramSettings } from '../types';

interface ActivityConfig {
    key: keyof InstagramSettings;
    label: string;
    hasSettings: boolean;
    settingsView?: 'feed' | 'reels' | 'stories' | 'follow' | 'unfollow' | 'message';
}

const ACTIVITIES: ActivityConfig[] = [
    { key: 'enable_feed', label: 'Feed Scroll', hasSettings: true, settingsView: 'feed' },
    { key: 'enable_reels', label: 'Reels Scroll', hasSettings: true, settingsView: 'reels' },
    { key: 'watch_stories', label: 'Watch Stories', hasSettings: true, settingsView: 'stories' },
    { key: 'enable_follow', label: 'Follow', hasSettings: true, settingsView: 'follow' },
    { key: 'do_unfollow', label: 'Unfollow', hasSettings: true, settingsView: 'unfollow' },
    { key: 'do_approve', label: 'Approve Requests', hasSettings: false },
    { key: 'do_message', label: 'Send Messages', hasSettings: true, settingsView: 'message' },
];

interface ActivitySettingsProps {
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
    onOpenSettings: (view: 'feed' | 'reels' | 'stories' | 'follow' | 'unfollow' | 'message') => void;
}

export function ActivitySettings({ settings, onUpdate, onOpenSettings }: ActivitySettingsProps) {
    return (
        <Card>
            <CardHeader className="p-3 pb-1">
                <CardTitle className="text-sm font-medium">Activities</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
                <div className="grid grid-cols-2 gap-2">
                    {ACTIVITIES.map((activity) => (
                        <div
                            key={activity.key}
                            className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                        >
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id={activity.key}
                                    checked={!!settings[activity.key]}
                                    onCheckedChange={(checked) => onUpdate(prev => ({
                                        ...prev,
                                        [activity.key]: !!checked
                                    }))}
                                />
                                <label
                                    htmlFor={activity.key}
                                    className="text-sm font-medium cursor-pointer"
                                >
                                    {activity.label}
                                </label>
                            </div>
                            {activity.hasSettings && activity.settingsView && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => onOpenSettings(activity.settingsView!)}
                                >
                                    <Settings className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
