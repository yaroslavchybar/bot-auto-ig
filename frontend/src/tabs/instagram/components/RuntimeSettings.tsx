import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings } from 'lucide-react';
import type { InstagramSettings } from '../types';

interface RuntimeSettingsProps {
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
    onOpenCooldownDialog: (kind: 'profile_reopen' | 'messaging') => void;
}

export function RuntimeSettings({ settings, onUpdate, onOpenCooldownDialog }: RuntimeSettingsProps) {
    return (
        <Card>
            <CardHeader className="p-3 pb-1">
                <CardTitle className="text-sm font-medium">Runtime Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3 pt-0">
                <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                        <Label htmlFor="max_sessions">Max Sessions</Label>
                        <Input
                            id="max_sessions"
                            type="number"
                            min={1}
                            max={100}
                            value={settings.max_sessions}
                            onChange={(e) => onUpdate(prev => ({
                                ...prev,
                                max_sessions: Math.max(1, Math.min(100, parseInt(e.target.value) || 1))
                            }))}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="parallel_profiles">Parallel Profiles</Label>
                        <Input
                            id="parallel_profiles"
                            type="number"
                            min={1}
                            max={10}
                            value={settings.parallel_profiles}
                            onChange={(e) => onUpdate(prev => ({
                                ...prev,
                                parallel_profiles: Math.max(1, Math.min(10, parseInt(e.target.value) || 1))
                            }))}
                        />
                    </div>
                </div>

                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="headless"
                        checked={settings.headless}
                        onCheckedChange={(checked) => onUpdate(prev => ({ ...prev, headless: !!checked }))}
                    />
                    <Label htmlFor="headless" className="cursor-pointer">Headless Mode</Label>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="profile_reopen_cooldown"
                            checked={settings.profile_reopen_cooldown_enabled}
                            onCheckedChange={(checked) => onUpdate(prev => ({
                                ...prev,
                                profile_reopen_cooldown_enabled: !!checked
                            }))}
                        />
                        <Label htmlFor="profile_reopen_cooldown" className="cursor-pointer">
                            Profile Reopen Cooldown ({settings.profile_reopen_cooldown_minutes}m)
                        </Label>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onOpenCooldownDialog('profile_reopen')}
                    >
                        <Settings className="h-4 w-4" />
                    </Button>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="messaging_cooldown"
                            checked={settings.messaging_cooldown_enabled}
                            onCheckedChange={(checked) => onUpdate(prev => ({
                                ...prev,
                                messaging_cooldown_enabled: !!checked
                            }))}
                        />
                        <Label htmlFor="messaging_cooldown" className="cursor-pointer">
                            Messaging Cooldown ({settings.messaging_cooldown_hours}h)
                        </Label>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onOpenCooldownDialog('messaging')}
                    >
                        <Settings className="h-4 w-4" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
