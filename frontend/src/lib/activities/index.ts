/**
 * Activity Registry
 * 
 * This is the main entry point for all workflow activities.
 * Import from here to get access to all activities and helpers.
 * 
 * FOLDER STRUCTURE:
 * - types.ts         → Type definitions
 * - browsing/        → Feed and reels activities
 * - engagement/      → Follow/unfollow activities
 * - messaging/       → DM activities
 * - stories/         → Story watching activities
 * - control/         → Flow control (delay, loop, etc.)
 * 
 * TO ADD A NEW ACTIVITY:
 * 1. Create a new file in the appropriate category folder
 * 2. Export it from that folder's index.ts
 * 3. It will be automatically included in the registry
 */

// Re-export all types
export * from './types';
export type { ActivityCategory, InputType, ActivityInput, ActivityInputOption, ActivityOutput, ActivityDefinition } from './types';

// Import all activity groups
import { browsingActivities } from './browsing';
import { engagementActivities } from './engagement';
import { messagingActivities } from './messaging';
import { storiesActivities } from './stories';
import { controlActivities } from './control';

import type { ActivityCategory, ActivityDefinition } from './types';

// ============================================================================
// REGISTRY - All activities combined
// ============================================================================

export const ACTIVITY_REGISTRY: ActivityDefinition[] = [
	...browsingActivities,
	...engagementActivities,
	...messagingActivities,
	...storiesActivities,
	...controlActivities,
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Find an activity by its ID
 */
export function getActivityById(id: string): ActivityDefinition | undefined {
	return ACTIVITY_REGISTRY.find(a => a.id === id);
}

/**
 * Get all activities in a category
 */
export function getActivitiesByCategory(category: ActivityCategory): ActivityDefinition[] {
	return ACTIVITY_REGISTRY.filter(a => a.category === category);
}

/**
 * Get list of all categories
 */
export function getAllCategories(): ActivityCategory[] {
	return ['browsing', 'engagement', 'messaging', 'stories', 'control'];
}

/**
 * Get display label for a category
 */
export function getCategoryLabel(category: ActivityCategory): string {
	const labels: Record<ActivityCategory, string> = {
		browsing: 'Browsing',
		engagement: 'Engagement',
		messaging: 'Messaging',
		stories: 'Stories',
		control: 'Control Flow',
	};
	return labels[category];
}

/**
 * Get icon name for a category
 */
export function getCategoryIcon(category: ActivityCategory): string {
	const icons: Record<ActivityCategory, string> = {
		browsing: 'Scroll',
		engagement: 'Users',
		messaging: 'MessageCircle',
		stories: 'CircleDot',
		control: 'Settings2',
	};
	return icons[category];
}

/**
 * Generate default config values for an activity
 */
export function getDefaultConfig(activityId: string): Record<string, unknown> {
	const activity = getActivityById(activityId);
	if (!activity) return {};

	const config: Record<string, unknown> = {};
	for (const input of activity.inputs) {
		if (input.default !== undefined) {
			config[input.name] = input.default;
		}
	}
	return config;
}

/**
 * Validate config values against activity definition
 * Returns array of error messages (empty = valid)
 */
export function validateConfig(activityId: string, config: Record<string, unknown>): string[] {
	const activity = getActivityById(activityId);
	if (!activity) return ['Unknown activity'];

	const errors: string[] = [];
	for (const input of activity.inputs) {
		const value = config[input.name];

		// Check required
		if (input.required && (value === undefined || value === null || value === '')) {
			errors.push(`${input.label} is required`);
			continue;
		}

		// Validate number ranges
		if (value !== undefined && value !== null) {
			if (input.type === 'number') {
				const num = Number(value);
				if (isNaN(num)) {
					errors.push(`${input.label} must be a number`);
				} else {
					if (input.min !== undefined && num < input.min) {
						errors.push(`${input.label} must be at least ${input.min}`);
					}
					if (input.max !== undefined && num > input.max) {
						errors.push(`${input.label} must be at most ${input.max}`);
					}
				}
			}
		}
	}
	return errors;
}
