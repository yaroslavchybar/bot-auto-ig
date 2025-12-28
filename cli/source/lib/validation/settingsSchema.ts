import { InstagramSettings, ACTIONS } from '../../types/index.js';

export function validateSettings(settings: any): InstagramSettings | Error {
    if (typeof settings !== 'object' || settings === null) {
        return new Error('Settings must be an object');
    }

    const errors: string[] = [];

    // Helper for numeric range
    const checkRange = (key: string, min: number, max: number) => {
        const val = settings[key];
        if (typeof val !== 'number') {
            errors.push(`${key} must be a number`);
        } else if (val < min || val > max) {
            errors.push(`${key} must be between ${min} and ${max}`);
        }
    };

    // Required fields / type checks
    if (typeof settings.automation_enabled !== 'boolean') errors.push('automation_enabled must be boolean');
    if (typeof settings.headless !== 'boolean') errors.push('headless must be boolean');

    checkRange('max_sessions', 1, 100);
    checkRange('parallel_profiles', 1, 10);
    checkRange('like_chance', 0, 100);
    checkRange('follow_chance', 0, 100);
    checkRange('reels_like_chance', 0, 100);
    checkRange('reels_follow_chance', 0, 100);
    checkRange('reels_skip_chance', 0, 100);

    if (!Array.isArray(settings.source_list_ids)) {
        errors.push('source_list_ids must be an array');
    }

    if (!Array.isArray(settings.action_order)) {
        errors.push('action_order must be an array');
    } else {
        for (const action of settings.action_order) {
            if (!ACTIONS.includes(action as any)) {
                errors.push(`Invalid action in order: ${action}`);
            }
        }
    }

    if (errors.length > 0) {
        return new Error(`Validation failed:\n- ${errors.join('\n- ')}`);
    }

    return settings as InstagramSettings;
}
