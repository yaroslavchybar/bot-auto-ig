import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { InstagramSettings } from '../types';

interface StoriesSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
}

export function StoriesSettingsDialog({ open, onOpenChange, settings, onUpdate }: StoriesSettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Stories Settings</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="stories_max">Max Stories to Watch</Label>
                        <Input
                            id="stories_max"
                            type="number"
                            min={1}
                            max={50}
                            value={settings.stories_max}
                            onChange={(e) => onUpdate(prev => ({
                                ...prev,
                                stories_max: Math.max(1, Math.min(50, parseInt(e.target.value) || 1))
                            }))}
                        />
                        <p className="text-xs text-muted-foreground">
                            Maximum number of stories to watch per profile
                        </p>
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
