import { useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LogEntry } from '@/hooks/useWebSocket';

interface LiveLogsPanelProps {
    logs: LogEntry[];
    onClear: () => void;
    className?: string;
}

export function LiveLogsPanel({ logs, onClear, className }: LiveLogsPanelProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Only show last 20 logs
    const visibleLogs = useMemo(() => logs.slice(-20), [logs]);

    useEffect(() => {
        // Target the ScrollArea viewport for auto-scroll
        const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }, [visibleLogs]);

    const getLevelColor = (level: string) => {
        switch (level) {
            case 'error':
                return 'text-red-500';
            case 'warn':
                return 'text-yellow-500';
            case 'success':
                return 'text-green-500';
            default:
                return 'text-muted-foreground';
        }
    };

    const formatTime = (ts: number) => {
        const date = new Date(ts);
        return date.toLocaleTimeString('en-US', { hour12: false });
    };

    return (
        <Card className={cn("flex flex-col h-full min-h-[300px]", className)}>
            <CardHeader className="p-3 pb-1 flex-none">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">Live Logs</CardTitle>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={onClear}
                        disabled={logs.length === 0}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full" ref={scrollRef}>
                    <div className="p-3 pt-0 space-y-1">
                        {visibleLogs.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                No logs yet
                            </p>
                        ) : (
                            visibleLogs.map((log, index) => (
                                <div
                                    key={`${log.ts}-${index}`}
                                    className={`text-xs font-mono ${getLevelColor(log.level)}`}
                                >
                                    <span className="text-muted-foreground">[{formatTime(log.ts)}]</span>
                                    {log.source && (
                                        <span className="text-muted-foreground"> [{log.source}]</span>
                                    )}
                                    <span> {log.message}</span>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
