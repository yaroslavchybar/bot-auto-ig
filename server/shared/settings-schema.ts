import { InstagramSettings, ACTIONS } from './types.js';

type RangeCheck = (key: string, min: number, max: number) => void;

function validateBooleanFields(settings: any, errors: string[]): void {
	const booleanFields = [
		'automation_enabled', 'use_private_profiles', 'headless',
		'enable_feed', 'enable_reels', 'enable_follow', 'watch_stories',
		'profile_reopen_cooldown_enabled', 'messaging_cooldown_enabled',
		'do_unfollow', 'do_approve', 'do_message',
	];
	for (const field of booleanFields) {
		if (typeof settings[field] !== 'boolean') errors.push(`${field} must be boolean`);
	}
}

function validateNumericRanges(checkRange: RangeCheck): void {
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
}

function validateMinMaxPairs(settings: any, errors: string[]): void {
	const pairs: [string, string][] = [
		['reels_skip_min_time', 'reels_skip_max_time'],
		['reels_normal_min_time', 'reels_normal_max_time'],
		['feed_min_time_minutes', 'feed_max_time_minutes'],
		['reels_min_time_minutes', 'reels_max_time_minutes'],
		['highlights_min', 'highlights_max'],
		['follow_min_count', 'follow_max_count'],
		['unfollow_min_count', 'unfollow_max_count'],
		['min_delay', 'max_delay'],
	];
	for (const [minKey, maxKey] of pairs) {
		if (typeof settings[minKey] === 'number' && typeof settings[maxKey] === 'number') {
			if (settings[minKey] > settings[maxKey]) errors.push(`${minKey} must be <= ${maxKey}`);
		}
	}
}

export function validateSettings(settings: any): InstagramSettings | Error {
	if (typeof settings !== 'object' || settings === null) {
		return new Error('Settings must be an object');
	}

	const errors: string[] = [];

	const checkRange: RangeCheck = (key, min, max) => {
		const val = settings[key];
		if (typeof val !== 'number') {
			errors.push(`${key} must be a number`);
		} else if (val < min || val > max) {
			errors.push(`${key} must be between ${min} and ${max}`);
		}
	};

	validateBooleanFields(settings, errors);
	validateNumericRanges(checkRange);
	validateMinMaxPairs(settings, errors);

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
