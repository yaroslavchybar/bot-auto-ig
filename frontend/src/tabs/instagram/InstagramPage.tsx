import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useInstagramSettings } from './hooks/useInstagramSettings';

// Components
import { RuntimeSettings } from './components/RuntimeSettings';
import { ActivitySettings } from './components/ActivitySettings';
import { SourceListsSelector } from './components/SourceListsSelector';
import { ActionOrderManager } from './components/ActionOrderManager';
import { AutomationControls } from './components/AutomationControls';
import { LiveLogsPanel } from './components/LiveLogsPanel';

// Dialogs
import { FeedSettingsDialog } from './dialogs/FeedSettingsDialog';
import { ReelsSettingsDialog } from './dialogs/ReelsSettingsDialog';
import { StoriesSettingsDialog } from './dialogs/StoriesSettingsDialog';
import { FollowSettingsDialog } from './dialogs/FollowSettingsDialog';
import { UnfollowSettingsDialog } from './dialogs/UnfollowSettingsDialog';
import { CooldownDialog } from './dialogs/CooldownDialog';
import { MessageSettingsDialog } from './dialogs/MessageSettingsDialog';

import { RefreshCw, List } from 'lucide-react';

type SettingsView = 'feed' | 'reels' | 'stories' | 'follow' | 'unfollow' | 'message';
type CooldownKind = 'profile_reopen' | 'messaging';

export function InstagramPage() {
    const { settings, loading, saving, error, load, updateSettings } = useInstagramSettings();
    const { logs, status, progress, clearLogs } = useWebSocket();

    // Dialog states
    const [showListsDialog, setShowListsDialog] = useState(false);
    const [activeSettingsDialog, setActiveSettingsDialog] = useState<SettingsView | null>(null);
    const [activeCooldownDialog, setActiveCooldownDialog] = useState<CooldownKind | null>(null);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading settings...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-2 h-full flex flex-col space-y-3 overflow-hidden">
            <div className="flex items-center justify-between flex-none">
                <div>
                    <h1 className="text-2xl font-bold">Instagram Automation</h1>
                    <p className="text-sm text-muted-foreground">
                        Configure and control automation settings
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {saving && (
                        <span className="text-xs text-muted-foreground">Saving...</span>
                    )}
                    <Button variant="outline" size="sm" onClick={() => load()}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Reload
                    </Button>
                </div>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
                <ScrollArea className="h-full">
                    <div className="space-y-3 pr-3 pb-3">
                        <RuntimeSettings
                            settings={settings}
                            onUpdate={updateSettings}
                            onOpenCooldownDialog={(kind) => setActiveCooldownDialog(kind)}
                        />

                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => setShowListsDialog(true)}
                            >
                                <List className="h-4 w-4 mr-2" />
                                Source Lists
                                {settings.source_list_ids.length > 0 && (
                                    <span className="ml-2 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs">
                                        {settings.source_list_ids.length}
                                    </span>
                                )}
                            </Button>
                        </div>

                        <ActivitySettings
                            settings={settings}
                            onUpdate={updateSettings}
                            onOpenSettings={(view) => setActiveSettingsDialog(view)}
                        />
                    </div>
                </ScrollArea>

                <div className="space-y-3 flex flex-col h-full overflow-hidden">
                    <ActionOrderManager
                        settings={settings}
                        onUpdate={updateSettings}
                    />

                    <AutomationControls
                        settings={settings}
                        status={status}
                        progress={progress}
                    />

                    <LiveLogsPanel
                        logs={logs}
                        onClear={clearLogs}
                        className="flex-1"
                    />
                </div>
            </div>

            {/* Dialogs */}
            <SourceListsSelector
                open={showListsDialog}
                onOpenChange={setShowListsDialog}
                settings={settings}
                onUpdate={updateSettings}
            />

            <FeedSettingsDialog
                open={activeSettingsDialog === 'feed'}
                onOpenChange={(open) => !open && setActiveSettingsDialog(null)}
                settings={settings}
                onUpdate={updateSettings}
            />

            <ReelsSettingsDialog
                open={activeSettingsDialog === 'reels'}
                onOpenChange={(open) => !open && setActiveSettingsDialog(null)}
                settings={settings}
                onUpdate={updateSettings}
            />

            <StoriesSettingsDialog
                open={activeSettingsDialog === 'stories'}
                onOpenChange={(open) => !open && setActiveSettingsDialog(null)}
                settings={settings}
                onUpdate={updateSettings}
            />

            <FollowSettingsDialog
                open={activeSettingsDialog === 'follow'}
                onOpenChange={(open) => !open && setActiveSettingsDialog(null)}
                settings={settings}
                onUpdate={updateSettings}
            />

            <UnfollowSettingsDialog
                open={activeSettingsDialog === 'unfollow'}
                onOpenChange={(open) => !open && setActiveSettingsDialog(null)}
                settings={settings}
                onUpdate={updateSettings}
            />

            <MessageSettingsDialog
                open={activeSettingsDialog === 'message'}
                onOpenChange={(open) => !open && setActiveSettingsDialog(null)}
                settings={settings}
                onUpdate={updateSettings}
            />

            <CooldownDialog
                open={activeCooldownDialog !== null}
                onOpenChange={(open) => !open && setActiveCooldownDialog(null)}
                kind={activeCooldownDialog || 'profile_reopen'}
                settings={settings}
                onUpdate={updateSettings}
            />
        </div>
    );
}
