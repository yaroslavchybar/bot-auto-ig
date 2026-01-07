import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Play, Square, Loader2, User, Activity } from 'lucide-react';
import type { InstagramSettings } from '../types';
import type { AutomationProgress } from '@/hooks/useWebSocket';
import { apiFetch } from '@/lib/api';

interface AutomationControlsProps {
    settings: InstagramSettings;
    status: 'idle' | 'running' | 'stopping';
    progress?: AutomationProgress;
    onStatusChange?: (status: 'idle' | 'running' | 'stopping') => void;
}

export function AutomationControls({ settings, status, progress, onStatusChange }: AutomationControlsProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isRunning = status === 'running';
    const isStopping = status === 'stopping';

    const validateSettings = (): string | null => {
        const hasActivity =
            settings.enable_feed ||
            settings.enable_reels ||
            settings.watch_stories ||
            settings.enable_follow ||
            settings.do_unfollow ||
            settings.do_approve ||
            settings.do_message;

        if (!hasActivity) {
            return 'Enable at least one activity';
        }
        if (settings.source_list_ids.length === 0) {
            return 'Select at least one source list';
        }
        return null;
    };

    const handleStart = async () => {
        const validationError = validateSettings();
        if (validationError) {
            setError(validationError);
            return;
        }

        setError(null);
        setLoading(true);

        try {
            await apiFetch('/api/automation/start', {
                method: 'POST',
                body: settings,
            });

            onStatusChange?.('running');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start automation');
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        setError(null);
        setLoading(true);

        try {
            await apiFetch('/api/automation/stop', {
                method: 'POST',
            });

            onStatusChange?.('stopping');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to stop automation');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className={isRunning ? 'border-green-500' : isStopping ? 'border-yellow-500' : ''}>
            <CardContent className="pt-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-3 h-3 rounded-full ${isRunning
                                ? 'bg-green-500 animate-pulse'
                                : isStopping
                                    ? 'bg-yellow-500 animate-pulse'
                                    : 'bg-gray-400'
                                }`}
                        />
                        <div>
                            <p className="font-medium">
                                {isRunning ? 'Running' : isStopping ? 'Stopping...' : 'Stopped'}
                            </p>
                            {settings.source_list_ids.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    {settings.source_list_ids.length} list(s) selected
                                </p>
                            )}
                        </div>
                    </div>

                    <Button
                        size="lg"
                        variant={isRunning ? 'destructive' : 'default'}
                        disabled={loading || isStopping}
                        onClick={isRunning ? handleStop : handleStart}
                    >
                        {loading ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : isRunning ? (
                            <Square className="h-4 w-4 mr-2" />
                        ) : (
                            <Play className="h-4 w-4 mr-2" />
                        )}
                        {isRunning ? 'Stop Automation' : 'Start Automation'}
                    </Button>
                </div>

                {isRunning && progress && (progress.currentProfile || progress.currentTask) && (
                    <div className="mt-4 space-y-2 pt-4 border-t">
                        {progress.currentProfile && (
                            <div className="flex items-center gap-2 text-sm">
                                <User className="h-4 w-4 text-muted-foreground" />
                                <span className="text-muted-foreground">Processing:</span>
                                <span className="font-medium">{progress.currentProfile}</span>
                            </div>
                        )}
                        {progress.currentTask && (
                            <div className="flex items-center gap-2 text-sm">
                                <Activity className="h-4 w-4 text-muted-foreground" />
                                <span className="text-muted-foreground">Action:</span>
                                <span>{progress.currentTask}</span>
                            </div>
                        )}
                    </div>
                )}

                {error && (
                    <p className="text-sm text-destructive mt-3">{error}</p>
                )}
            </CardContent>
        </Card>
    );
}
