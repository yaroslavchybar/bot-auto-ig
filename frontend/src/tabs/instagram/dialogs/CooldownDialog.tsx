import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { InstagramSettings } from '../types';
import { PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN, MESSAGING_COOLDOWN_OPTIONS_HOURS } from '../types';
import { Check } from 'lucide-react';

interface CooldownDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kind: 'profile_reopen' | 'messaging';
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
}

export function CooldownDialog({ open, onOpenChange, kind, settings, onUpdate }: CooldownDialogProps) {
    const isProfileReopen = kind === 'profile_reopen';
    const title = isProfileReopen ? 'Profile Reopen Cooldown' : 'Messaging Cooldown';
    const options = isProfileReopen ? PROFILE_REOPEN_COOLDOWN_OPTIONS_MIN : MESSAGING_COOLDOWN_OPTIONS_HOURS;
    const currentValue = isProfileReopen
        ? settings.profile_reopen_cooldown_minutes
        : settings.messaging_cooldown_hours;
    const unit = isProfileReopen ? 'min' : 'h';

    const handleSelect = (value: number) => {
        if (isProfileReopen) {
            onUpdate(prev => ({ ...prev, profile_reopen_cooldown_minutes: value }));
        } else {
            onUpdate(prev => ({ ...prev, messaging_cooldown_hours: value }));
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-4 gap-2">
                    {options.map((value) => (
                        <Button
                            key={value}
                            variant={currentValue === value ? 'default' : 'outline'}
                            className="relative"
                            onClick={() => handleSelect(value)}
                        >
                            {value}{unit}
                            {currentValue === value && (
                                <Check className="h-3 w-3 absolute top-1 right-1" />
                            )}
                        </Button>
                    ))}
                </div>

                <p className="text-xs text-muted-foreground text-center">
                    {isProfileReopen
                        ? 'Time to wait before reopening the same profile'
                        : 'Time to wait before messaging the same user again'}
                </p>
            </DialogContent>
        </Dialog>
    );
}
