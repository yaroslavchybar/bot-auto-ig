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
	if (typeof settings.use_private_profiles !== 'boolean') errors.push('use_private_profiles must be boolean');
	if (typeof settings.headless !== 'boolean') errors.push('headless must be boolean');
	if (typeof settings.enable_feed !== 'boolean') errors.push('enable_feed must be boolean');
	if (typeof settings.enable_reels !== 'boolean') errors.push('enable_reels must be boolean');
	if (typeof settings.enable_follow !== 'boolean') errors.push('enable_follow must be boolean');
	if (typeof settings.watch_stories !== 'boolean') errors.push('watch_stories must be boolean');
	if (typeof settings.profile_reopen_cooldown_enabled !== 'boolean') errors.push('profile_reopen_cooldown_enabled must be boolean');
	if (typeof settings.messaging_cooldown_enabled !== 'boolean') errors.push('messaging_cooldown_enabled must be boolean');
	if (typeof settings.do_unfollow !== 'boolean') errors.push('do_unfollow must be boolean');
	if (typeof settings.do_approve !== 'boolean') errors.push('do_approve must be boolean');
	if (typeof settings.do_message !== 'boolean') errors.push('do_message must be boolean');

	checkRange('max_sessions', 1, 100);
	checkRange('parallel_profiles', 1, 10);
	checkRange('like_chance', 0, 100);
	checkRange('carousel_watch_chance', 0, 100);
	checkRange('follow_chance', 0, 100);
	checkRange('reels_like_chance', 0, 100);
	checkRange('reels_follow_chance', 0, 100);
	checkRange('reels_skip_chance', 0, 100);

	checkRange('reels_skip_min_time', 0, 120);
	checkRange('reels_skip_max_time', 0, 120);
	checkRange('reels_normal_min_time', 0, 600);
	checkRange('reels_normal_max_time', 0, 600);

	checkRange('carousel_max_slides', 1, 50);
	checkRange('stories_max', 0, 100);

	checkRange('feed_min_time_minutes', 0, 240);
	checkRange('feed_max_time_minutes', 0, 240);
	checkRange('reels_min_time_minutes', 0, 240);
	checkRange('reels_max_time_minutes', 0, 240);

	checkRange('profile_reopen_cooldown_minutes', 0, 10080);
	checkRange('messaging_cooldown_hours', 0, 168);

	checkRange('highlights_min', 0, 100);
	checkRange('highlights_max', 0, 100);
	checkRange('likes_percentage', 0, 100);
	checkRange('scroll_percentage', 0, 100);
	checkRange('following_limit', 0, 1000000);
	checkRange('follow_min_count', 0, 1000);
	checkRange('follow_max_count', 0, 1000);
	checkRange('min_delay', 0, 3600);
	checkRange('max_delay', 0, 3600);
	checkRange('unfollow_min_count', 0, 1000);
	checkRange('unfollow_max_count', 0, 1000);

	if (typeof settings.reels_skip_min_time === 'number' && typeof settings.reels_skip_max_time === 'number') {
		if (settings.reels_skip_min_time > settings.reels_skip_max_time) errors.push('reels_skip_min_time must be <= reels_skip_max_time');
	}
	if (typeof settings.reels_normal_min_time === 'number' && typeof settings.reels_normal_max_time === 'number') {
		if (settings.reels_normal_min_time > settings.reels_normal_max_time) errors.push('reels_normal_min_time must be <= reels_normal_max_time');
	}
	if (typeof settings.feed_min_time_minutes === 'number' && typeof settings.feed_max_time_minutes === 'number') {
		if (settings.feed_min_time_minutes > settings.feed_max_time_minutes) errors.push('feed_min_time_minutes must be <= feed_max_time_minutes');
	}
	if (typeof settings.reels_min_time_minutes === 'number' && typeof settings.reels_max_time_minutes === 'number') {
		if (settings.reels_min_time_minutes > settings.reels_max_time_minutes) errors.push('reels_min_time_minutes must be <= reels_max_time_minutes');
	}
	if (typeof settings.highlights_min === 'number' && typeof settings.highlights_max === 'number') {
		if (settings.highlights_min > settings.highlights_max) errors.push('highlights_min must be <= highlights_max');
	}
	if (typeof settings.follow_min_count === 'number' && typeof settings.follow_max_count === 'number') {
		if (settings.follow_min_count > settings.follow_max_count) errors.push('follow_min_count must be <= follow_max_count');
	}
	if (typeof settings.unfollow_min_count === 'number' && typeof settings.unfollow_max_count === 'number') {
		if (settings.unfollow_min_count > settings.unfollow_max_count) errors.push('unfollow_min_count must be <= unfollow_max_count');
	}
	if (typeof settings.min_delay === 'number' && typeof settings.max_delay === 'number') {
		if (settings.min_delay > settings.max_delay) errors.push('min_delay must be <= max_delay');
	}

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
